---
phase: 08-moderation-tenant-admin-panel-pilot-hardening
plan: 02
subsystem: testing
tags: [test-debt, flake-triage, ci, sharding, e2e-pwa, windows-ledger, D-348, branding, stories, playwright]

# Dependency graph
requires:
  - phase: 07-notifications-web-push-chat
    provides: "the 07-15 exit-gate reds (WINDOWS 69-71), the 07-11 reds (WINDOWS 64-65), the 07-15 turbo.json typecheck-after-build override, and the 49.8 min single-worker e2e measurement"
  - phase: 08-moderation-tenant-admin-panel-pilot-hardening
    provides: "08-01 ran first on this tree (moderation tracer); no shared files"
provides:
  - "Marca form keyed on the tenant only; BrandingForm adopts a refreshed server view in place, so typed colours survive the icon-poll refresh (WINDOWS 71; the form 08-06 reuses on the tenant lane)"
  - "HighlightEditSheet keeps focus inside the sheet after an optimistic remove, so Escape still closes it (WINDOWS 70)"
  - "phase52-smoke and stories specs wait for React hydration before the 'Novo destaque' tap (WINDOWS 69)"
  - "phase2-smoke gives each --repeat-each iteration its own throwaway tenant and host"
  - "Re-proven green: WINDOWS 64 (double tap 5/5 desktop) and 65 (two typecheck+build runs, no ENOTEMPTY)"
  - "First e2e:pwa run on the production build: 46 passed, 5 skipped by design, exit 0"
  - "ci.yml split into static, db, e2e (4 shards) and e2e-pwa jobs, each within 60 minutes"
  - "Phase 8 deferred-items.md with every D-348 verdict and its evidence"
affects: [08-06 tenant-lane Marca, 08-12 go-live gate report, ci, deploy-api]

# Actuals (#2632)
actuals:
  tokens: 14360
  tasks: 3
  commits: 3
plan_head_before: a09413b7b7a2ff7b03e9e97e7713a09aec96388e

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Render-time adoption of a refreshed server prop (seed !== prop → setSeed + apply) instead of a key remount, for client forms the user types into"
    - "Optimistic unmount of a focused control: a layout effect returns focus into the modal before any key can reach <body>"
    - "e2e taps after a full document load wait for React's __reactProps key on the target (the 02-14 signal), never a sleep"
    - "Throwaway per-repeat fixture identity: suffix with testInfo.repeatEachIndex when the API caches host lookups"
    - "CI job-level concurrency groups name the job id literally (github.job is empty outside steps)"

key-files:
  created:
    - apps/web/components/platform/BrandingForm.test.tsx
    - .planning/phases/08-moderation-tenant-admin-panel-pilot-hardening/deferred-items.md
  modified:
    - apps/web/app/(platform)/plataforma/tenants/[id]/marca/page.tsx
    - apps/web/components/platform/BrandingForm.tsx
    - apps/web/e2e/phase2-smoke.spec.ts
    - apps/web/e2e/phase52-smoke.spec.ts
    - apps/web/e2e/stories.spec.ts
    - packages/modules/stories/ui/HighlightEditSheet.tsx
    - packages/modules/stories/tests/highlight-edit-sheet.test.tsx
    - .github/workflows/ci.yml
    - .planning/WINDOWS.md
    - .planning/phases/07-notifications-web-push-chat/deferred-items.md

key-decisions:
  - "WINDOWS 71: key the Marca form on the tenant id only, not on tenant id plus persisted colours. The refresh after a colour save carries the new colours, so that key would bring the same remount back one save later. The form adopts any newer view with the existing applyView rule"
  - "WINDOWS 70 is a product bug: an optimistic remove dropped focus to <body>, outside the panel-scoped Escape trap. The fix keeps focus in the sheet, on 'Adicionar stories' or the panel. The unstable closeEdit in HighlightManager is recorded as an observation, not changed"
  - "WINDOWS 69 is a test-timing flake: a tap before hydration after a full document load is lost. The specs wait for the hydration mark. No product change"
  - "CI concurrency groups use literal job ids plus the shard number instead of the plan's github.job. That context value is null at job-level concurrency evaluation, so all four jobs would share one group and cancel each other"
  - "CI repeats the local-stack bring-up verbatim per job: YAML anchors cannot splice a list of steps, and no composite action is added"

patterns-established:
  - "D-348 verdict record: one deferred-items entry per inherited red with verdict, cause, trace evidence, fix and the exact green command"
  - "WINDOWS rows flip only after a green run of their own spec, via gsd-tools windows fixed"

requirements-completed: [ADMIN-01, ADMIN-04]

coverage:
  - id: D1
    description: "The Marca form keeps a colour typed while the icon-poll refresh lands; phase2-smoke desktop case 1 is green 3 of 3 (WINDOWS 71)"
    requirement: "ADMIN-01"
    verification:
      - kind: unit
        ref: "apps/web/components/platform/BrandingForm.test.tsx#BrandingForm adopts a refreshed view in place (WINDOWS #71)"
        status: pass
      - kind: e2e
        ref: "pnpm db:reset && pnpm db:seed && VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test phase2-smoke.spec.ts --project=desktop-chromium --repeat-each=3 (15 passed, exit 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Escape closes 'Editar destaque' right after a remove, before the host re-read lands (WINDOWS 70)"
    requirement: "ADMIN-04"
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/highlight-edit-sheet.test.tsx#E8. after a remove, focus stays in the sheet and Escape closes it before the host re-reads"
        status: pass
      - kind: e2e
        ref: "playwright test stories.spec.ts -g \"create, rename, add the EXPIRED\" --project=mobile-chromium --repeat-each=3 (3 passed, exit 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The admin's highlight creation from both manage screens is green on mobile (WINDOWS 69)"
    requirement: "ADMIN-04"
    verification:
      - kind: e2e
        ref: "playwright test phase52-smoke.spec.ts stories.spec.ts --project=mobile-chromium (44 passed, 1 skipped by design, exit 0)"
        status: pass
      - kind: e2e
        ref: "playwright test phase52-smoke.spec.ts --project=mobile-chromium --repeat-each=3 (18 passed, exit 0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "WINDOWS 64 and 65 re-proven green; e2e:pwa run once on the production build"
    verification:
      - kind: e2e
        ref: "playwright test feed.spec.ts -g \"double tap\" --project=desktop-chromium --repeat-each=5 (15 passed, exit 0)"
        status: pass
      - kind: other
        ref: "rm -rf apps/web/.next && TURBO_CACHE=local:r pnpm turbo typecheck build --filter=@rede-social/web, twice (exit 0 both, 0 ENOTEMPTY)"
        status: pass
      - kind: e2e
        ref: "VIDEO_PROVIDER=fake pnpm --filter @rede-social/web e2e:pwa (46 passed, 5 skipped, exit 0)"
        status: pass
    human_judgment: false
  - id: D5
    description: "CI split into static, db, sharded e2e and e2e-pwa jobs that each finish within 60 minutes"
    verification:
      - kind: other
        ref: "python3 yaml structure check (jobs, timeouts <= 60, shards [1,2,3,4], distinct per-job concurrency groups, deploy-api.yml still calls ci.yml)"
        status: pass
    human_judgment: true
    rationale: "Only a real GitHub Actions run proves the jobs parse on GitHub and finish inside their limits. That run is the 08-12 gate's (D-348); this plan must not push or trigger Actions."

# Metrics
duration: 45min
completed: 2026-10-02
status: complete
---

# Phase 8 Plan 02: Inherited Test Debt and CI Split Summary

**The Marca form no longer remounts on the icon-poll refresh. The highlight edit sheet keeps focus (and Escape) after a remove. Hydration-gated taps fix the phase52 flake. All five inherited WINDOWS rows are proven green, e2e:pwa ran green for the first time, and CI is four jobs, each within 60 minutes.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-10-02T12:43:13Z
- **Completed:** 2026-10-02T13:28:19Z
- **Tasks:** 3 of 3
- **Files modified:** 12 (2 created, 10 modified)

## Accomplishments

- **WINDOWS 71 (product bug, A3 confirmed).** The Marca page keyed `BrandingForm` on the whole view. The poll's `router.refresh()` once icons were ready, and every action's `revalidatePath`, therefore remounted the form, dropping a colour typed while the refresh was in flight. The trace shows the fill 14 ms after the ready status, with the refresh RSC request still in flight. The form is now keyed on the tenant only and adopts newer views in place. phase2-smoke desktop, `--repeat-each=3`: 15 passed.
- **WINDOWS 70 (product bug).** The optimistic remove unmounted the focused "Remover" control. Focus fell to `<body>`, outside the sheet's panel-scoped Escape listener, and came back only when the host's re-read happened to re-arm the trap. The passing trace had an 18 ms margin. A layout effect now keeps focus in the sheet.
- **WINDOWS 69 (test-timing flake).** The manage screen arrives by a full document load, and a tap on the server-rendered "Novo destaque" before hydration is lost. Holding the JS chunks proved it: the tap landed unhydrated and no dialog opened afterwards. Both specs now wait for React's hydration mark before the tap.
- **WINDOWS 64 and 65** re-proven green on their own runs. **`e2e:pwa`** ran for the first time: 46 passed, 5 skipped by design, 0 failed.
- **CI split:** `static` (30 min), `db` (40), `e2e` as a 4-shard matrix (60 each, fail-fast off, its own stack per shard) and `e2e-pwa` (45). `deploy-api.yml` is unchanged and still gates production on every job.
- **Ledger:** rows 64, 65, 69, 70 and 71 are `fixed` (open 38 → 33, fixed 33 → 38, total 71). Nothing was waived and no `test.fixme` was added.

## Task Commits

1. **Task 1: WINDOWS 71 tracer: Marca remount** - `df582bf` (fix)
2. **Task 2: Triage 69, 70, 64, 65 and e2e:pwa** - `360bcde` (fix)
3. **Task 3: Split CI into four jobs** - `d09cd8c` (ci)

**Plan metadata:** recorded in the docs commits that follow this summary.

## WINDOWS Flips (each with the command that proved it)

| Row | Verdict | Proving run (all after `pnpm db:reset && pnpm db:seed`, local stack) | Result |
|-----|---------|------------------------------------------------------------------------|--------|
| 71 | product bug, fixed | `VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test phase2-smoke.spec.ts --project=desktop-chromium --repeat-each=3` | 15 passed, exit 0 |
| 69 | test-timing flake, spec fixed | `… playwright test phase52-smoke.spec.ts stories.spec.ts --project=mobile-chromium`, then `phase52-smoke.spec.ts --project=mobile-chromium --repeat-each=3` | 44 passed + 1 skipped (desktop-only case), exit 0; 18 passed, exit 0 |
| 70 | product bug, fixed | the mobile run above, then `stories.spec.ts -g "create, rename, add the EXPIRED" --project=mobile-chromium --repeat-each=3` | exit 0; 3 passed, exit 0 |
| 64 | leftover like (07-13), already fixed | `… playwright test feed.spec.ts -g "double tap" --project=desktop-chromium --repeat-each=5` | 15 passed (double-tap case 5/5), exit 0 |
| 65 | pipeline race, fixed by 07-15's turbo.json | `rm -rf apps/web/.next && TURBO_CACHE=local:r pnpm turbo typecheck build --filter=@rede-social/web`, twice | exit 0 both, 0 `ENOTEMPTY`, build before typecheck |

`test.fixme` lines added by this plan: none (`git diff -U0` over `apps/web/e2e` holds no `fixme`).

## e2e:pwa (for the 08-12 gate report)

`VIDEO_PROVIDER=fake pnpm --filter @rede-social/web e2e:pwa`, after a reset and seed with no dev server running: exit 0, **46 passed, 5 skipped, 0 failed, 0 flaky** (iPhone 14, Pixel 7, desktop on `next build && next start -p 3100`). The skips are by design:
- `pwa.spec.ts:104` display-mode standalone ×3: desktop by project. The two phones skip at runtime because Chromium ignores `display-mode` emulation, and real-device install stays the manual proof.
- `events-prefetch.spec.ts:65` on pixel and desktop: it runs on one phone project only.

## Files Created/Modified

- `apps/web/app/(platform)/plataforma/tenants/[id]/marca/page.tsx`: `formKey(id)`, so the form is keyed on the tenant only.
- `apps/web/components/platform/BrandingForm.tsx`:
  - adopts a new `view` prop during render (drops one with a lower `iconVersion`);
  - "untouched" also covers the raw fields;
  - no markup, copy or `BrandingActions` change.
- `apps/web/components/platform/BrandingForm.test.tsx` (new): 4 cases. 2 of them fail on the pre-fix form.
- `apps/web/e2e/phase2-smoke.spec.ts`: per-repeat throwaway suffix (`repeatEachIndex`).
- `apps/web/e2e/phase52-smoke.spec.ts`, `apps/web/e2e/stories.spec.ts`: hydration wait before the "Novo destaque" tap.
- `packages/modules/stories/ui/HighlightEditSheet.tsx`: a layout effect keeps focus in the sheet after an optimistic remove (a ref only, no markup change).
- `packages/modules/stories/tests/highlight-edit-sheet.test.tsx`: case E8, which fails on the pre-fix sheet.
- `.github/workflows/ci.yml`: the four-job split.
- `.planning/WINDOWS.md`: rows 64, 65, 69, 70 and 71 fixed.
- `.planning/phases/08-…/deferred-items.md` (new): the D-348 verdicts.
- `.planning/phases/07-…/deferred-items.md`: the four matching entries now point at the 08-02 verdicts.

## Decisions Made

See `key-decisions` in the frontmatter. The two that diverge from the plan's wording are listed as deviations below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] phase2-smoke reused one throwaway tenant for every `--repeat-each` iteration**
- **Found during:** Task 1 reproduction
- **Issue:** iteration 1 passed, but iterations 2 and 3 failed at step (c): by-host answered 200 where the pre-verification 404 is asserted. The previous repeat's tenant had been deleted by SQL, which bypasses the API's host-cache invalidation, so the same host was still answered. The plan's verify command (`--repeat-each=3`) could not pass without fixing this.
- **Fix:** the suffix carries `testInfo.repeatEachIndex` (repeat 0 keeps the old names), the quick 261001-ere remedy.
- **Files modified:** `apps/web/e2e/phase2-smoke.spec.ts`
- **Verification:** 15/15 passed with `--repeat-each=3`.
- **Committed in:** `df582bf`

**2. [Rule 1 - Bug] Form key: tenant id only, not tenant id plus persisted colours**
- **Found during:** Task 1
- **Issue:** the plan suggested keying on the tenant id plus the persisted colours. The refresh after a colour save carries the new colours, so that key would remount the form again one save later.
- **Fix:** key on the tenant id and adopt every newer view in place (`applyView` rule). The `formKey` name is kept for the key link.
- **Files modified:** the Marca `page.tsx`, `BrandingForm.tsx`
- **Committed in:** `df582bf`

**3. [Rule 2 - Missing critical] Regression unit tests for both product fixes**
- **Found during:** Tasks 1 and 2
- **Issue:** nothing pinned the remount fix or the focus fix below e2e level.
- **Fix:** added `BrandingForm.test.tsx` (new) and case E8 in `highlight-edit-sheet.test.tsx`. Each was red-checked against the pre-fix component (2 of 4, and E8, failed).
- **Committed in:** `df582bf`, `360bcde`

**4. [Rule 1 - Bug in the plan's check] CI concurrency groups do not use `github.job`**
- **Found during:** Task 3
- **Issue:** the plan prescribes `group: …-${{ github.job }}` and its python check asserts `github.job` in every group. GitHub documents `github.job` as set by the runner for steps only and null otherwise. A job-level `concurrency` group built on it would therefore be the same string for all four jobs, and with `cancel-in-progress` the jobs of one run would cancel each other (T-08-13 itself).
- **Fix:** each group names its job id literally (`…-static`, `…-db`, `…-e2e-${{ matrix.shard }}`, `…-e2e-pwa`). The header comment records why.
- **Verification:** the plan's literal check fails only on that assertion. A corrected check passes: 4 distinct groups, each containing its job id (and the shard for e2e), plus all the other structure assertions. `ctx7` and `actionlint` are not installed, so the `github.job` availability rests on GitHub's context reference as known, and the 08-12 CI run is the real proof.
- **Committed in:** `d09cd8c`

**5. [Rule 2 - Hygiene] Phase 7 deferred entries pointed at the 08-02 verdicts**
- **Issue:** the 07 entries for 65, 69, 70 and 71 still read `status: open` and would keep surfacing in audit-open.
- **Fix:** each is `status: resolved` with a pointer line. The "07-15 exit gate run" entry stays open, because the full gate belongs to 08-12.
- **Committed in:** `360bcde`

**6. [Rule 2 - Parity] `e2e-pwa` job also waits for the Realtime partition**
- **Issue:** the plan's e2e-pwa step list omits it, but the signed-in shell subscribes to Realtime, as in the e2e shards.
- **Fix:** added the same wait step. It does not change any of the plan's grep counts.
- **Committed in:** `d09cd8c`

---

**Total deviations:** 6 auto-fixed (3 Rule 1, 3 Rule 2).
**Impact on plan:** each was needed to meet the plan's own verify, for correctness, or for honest ledgers. No assertion was loosened, no timeout widened, no retry added. The only new wait bound is the 02-14 hydration helper's 30 s, on a readiness signal.

## Issues Encountered

- **#69 and #70 did not reproduce under `--repeat-each=3 --trace=on`** (18/18 and 3/3). Both failed once in the 788-test 07-15 run. Each verdict therefore rests on trace timing (81 ms tap-after-navigation, and an 18 ms Escape margin) plus a throwaway probe that forced each window open deterministically (held JS chunks; actions slowed by 1.5 s). The probe file was deleted and never committed.
- Throughout, the dev servers were restarted after every reset so no in-memory host cache outlived the database.

## Known Stubs

None.

## Threat Flags

None. The CI change stays inside the plan's threat model:
- T-08-10: `pull_request` only, `contents: read`, local-stack-only env.
- T-08-11: `deploy-api.yml` is unchanged.
- T-08-12: no quarantines.
- T-08-13: distinct per-job and per-shard groups.

## Authentication Gates

None.

## User Setup Required

None. No external service configuration is required. As the repo rules require, `ci.yml` is committed but not pushed. The first real CI run belongs to the 08-12 gate.

## DB Resets

The developer consented on 2026-10-02 (this session) to `pnpm db:reset && pnpm db:seed` on the LOCAL stack for every Phase 8 plan, with a backup at `~/rede-social-local-backups/pre-08-reset.sql`. 08-02 ran six local resets, before each proving run. Nothing touched the hosted Supabase, GCP, Vercel or GitHub Actions.

## Next Phase Readiness

- 08-06 can reuse `BrandingForm` on the tenant lane: typed state now survives icon polling and action revalidation.
- The 08-12 gate has a trustworthy local baseline: all five inherited rows are fixed and `e2e:pwa` is green once. The full `pnpm verify` and the first split-CI run are still the gate's to produce.
- Observation, not fixed: `HighlightManager`'s `closeEdit` is unstable, so focus jumps to the sheet's first control after each re-read (recorded in deferred-items).

## Self-Check: PASSED

- All 11 key files exist on disk.
- Commits `df582bf`, `360bcde` and `d09cd8c` are present in `git log`.
- None of them carries a co-author trailer.
- No throwaway probe is left in `apps/web/e2e`.

---
*Phase: 08-moderation-tenant-admin-panel-pilot-hardening*
*Completed: 2026-10-02*
