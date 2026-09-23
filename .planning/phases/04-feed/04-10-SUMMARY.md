---
phase: 04-feed
plan: 10
subsystem: module-registry
status: complete
tags: [cleanup, d-19, mod-03, module-registry, migration, smoke, exit-gate]

requires:
  - "@tria/module-feed satisfying the module contract end to end (04-01..04-09)"
  - "the feed substitution in supabase/tests/020-tenant-isolation.sql and 030-lanes.sql (04-01, 04-03)"
provides:
  - "MOD-03 demonstrated: a module removed in one commit range with nothing else changing behaviour"
  - "apps/web/e2e/phase4-smoke.spec.ts — the per-phase two-witness module-flag smoke"
  - "supabase/migrations/20260923035937_drop_example_module.sql — the forward-only removal"
  - "setTenantModuleFlag as a shared e2e fixture (tenant-fixtures.ts), one implementation"
affects:
  - "packages/contracts (TOGGLEABLE_MODULES is now identical to REAL_TENANT_DEFAULT_MODULES)"
  - "packages/core/server/platform (two per-key special cases retired)"
  - "apps/api/src/modules/registry.ts, apps/api/src/app.ts (one fewer module, one fewer mount)"
  - "public.tenant_modules (tenant_modules_key_chk narrowed to six keys)"

tech-stack:
  added: []
  patterns:
    - "A module comes out the way it went in: one registry line, one mount, one workspace dep, one catalog namespace, one migration"
    - "A retired special case is replaced by an assertion on the rule that survives (the key vocabulary), never simply deleted"
    - "A negative lint fixture is REPOINTED, never removed — deleting the violation turns a negative check into no test"
    - "A generated migration may be hand-extended when ordering is a correctness constraint; the snapshot stays untouched so db:generate remains idempotent"

key-files:
  created:
    - apps/web/e2e/phase4-smoke.spec.ts
    - supabase/migrations/20260923035937_drop_example_module.sql
  modified:
    - packages/contracts/src/modules.ts
    - packages/core/server/platform/modules.ts
    - packages/core/server/platform/tenants.ts
    - packages/boundary-fixture/src/index.ts
    - packages/boundary-fixture/package.json
    - apps/api/src/modules/registry.ts
    - apps/api/src/app.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/integration/jobs.test.ts
    - apps/api/tests/integration/auth-middleware.test.ts
    - apps/web/e2e/shell.spec.ts
    - apps/web/e2e/phase2-smoke.spec.ts
    - apps/web/e2e/tenant-fixtures.ts
    - supabase/tests/020-tenant-isolation.sql
    - scripts/seed.ts

key-decisions:
  - "The boundary fixture now DECLARES @tria/module-feed rather than importing it undeclared. turbo then reports the module→module violation explicitly (the tag allowlist) instead of only 'undeclared import' — strictly more of the rule under test."
  - "The row delete was hand-added to the GENERATED migration rather than split into a --custom file. Splitting would let the two halves be applied in the wrong order on a future environment, which is the exact failure the ordering exists to prevent."
  - "The isolation gate's disabled-module case needed a NEW throwaway tenant with feed off: it used to ride on tria-lab, which lacks the reference module but HAS the feed (D-17)."
  - "shell.spec.ts's two seed-tenant cases now assert the identical nav ['Início','Perfil']. That sameness is correct, not a weakened assertion — no seed tenant carries a module tab any more, and the tab-bearing witness moved to phase4-smoke.spec.ts on a throwaway tenant."
  - "setTenantModuleFlag lifted from phase2-smoke.spec.ts into tenant-fixtures.ts: two smokes needed it and two copies would have drifted on the ON CONFLICT clause."

requirements-completed: [MOD-03]

coverage:
  - deliverable: "@tria/module-example removed from the workspace, the registry, the catalog, the seed and the database"
    human_judgment: false
    verification:
      - kind: command
        ref: "git ls-files -- packages/modules/example (empty) && grep -rl module-example apps packages scripts supabase (empty)"
        status: pass
      - kind: command
        ref: "psql: to_regclass('public.example_items') is null; 0 tenant_modules rows with module_key='example'"
        status: pass
      - kind: test
        ref: "apps/api/tests/unit/registry.test.ts#1 (MODULE_REGISTRY keys === ['feed'])"
        status: pass
  - deliverable: "The negative boundary check keeps both of its violations, repointed at the feed module"
    human_judgment: false
    verification:
      - kind: command
        ref: "pnpm boundaries:negative — both layers reject the fixture (turbo reports 2 issues: app dep + module→module)"
        status: pass
  - deliverable: "The isolation gate is exactly as strong after the removal as before it"
    human_judgment: false
    verification:
      - kind: test
        ref: "supabase/tests/020-tenant-isolation.sql (plan 73, all ok) + 030-lanes.sql"
        status: pass
      - kind: test
        ref: "apps/api/tests/integration/isolation.test.ts (list/detail/empty/disabled/blocked/host/platform, all on /v1/feed)"
        status: pass
  - deliverable: "The forward-only removal migration applies from a cold stack in the only order that works"
    human_judgment: false
    verification:
      - kind: command
        ref: "pnpm db:reset && pnpm db:seed && pnpm db:generate → 'No schema changes', no check-constraint violation"
        status: pass
  - deliverable: "The per-phase smoke witnesses the feed in both directions of its module flag"
    human_judgment: false
    verification:
      - kind: test
        ref: "apps/web/e2e/phase4-smoke.spec.ts (8 tests, mobile-chromium + desktop-chromium)"
        status: pass
  - deliverable: "The phase exit gate is green end to end"
    human_judgment: false
    verification:
      - kind: command
        ref: "pnpm verify — exit 0, 21m51s, no step skipped"
        status: pass
  - deliverable: "Phase 4 acceptance on real hardware (double-tap like, gallery swipe, OS share sheet, phone video publish)"
    human_judgment: true
    rationale: "Gestures on real iOS/Android and the native OS share sheet are outside the browser automation boundary; a real transcode and real-device HLS playback stay blocked on the deferred cloud phase 01.1."
  - deliverable: "Sketch 002 design approval"
    human_judgment: true
    rationale: "Carried from 04-04 (WINDOWS 28). The design team has not signed off; deltas are follow-up polish per the 02-04 precedent, not phase blockers."

metrics:
  duration: 87 min
  completed: 2026-09-23
  tasks: 3
  files: 52

actuals:
  tokens: 187153
  tasks: 3
  commits: 4

commits: 4
plan_head_before: 9c72952b0f1632da5f7be005adb54d3c08c88aac
---

# Phase 4 Plan 10: Remove the reference module, ship the smoke, run the exit gate — Summary

D-19 closed by deletion rather than by assertion: `@tria/module-example` is gone from the workspace,
the registry, the route table, the catalog, the seed and the database, and every rule it carried was
repointed at `@tria/module-feed` instead of dropped — which is the only way the removal proves MOD-03
rather than merely claiming it.

## Accomplishments

**1. The package and every reference to it (`6f7631c`).** Fifteen source files deleted, twenty-six
modified. The registry entry, the `/v1/example` mount, the home-slot renderer, the pt-BR catalog
namespace, both workspace dependencies and the demo tenant's seeded flag all went in one reviewable
commit range, and nothing else changed behaviour.

**2. The two platform special cases retired, not orphaned.** `setModuleEnabled` had an explicit
branch refusing the reference key and `createTenant` had `enabled: key !== 'example' && wanted.has(key)`.
Both are gone. Their tests were **rewritten, not deleted**, to assert the rule that actually survives:
the key VOCABULARY refuses an unknown key — at the route (`z.enum(REAL_TENANT_DEFAULT_MODULES)`), in
`defineModule`, and in the database (`tenant_modules_key_chk`, asserted now by SQLSTATE `23514` and
constraint name rather than by a message string drizzle wraps).

**3. The boundary fixture repointed, and made stronger.** `packages/boundary-fixture` now imports
`@tria/module-feed/server/service` — a path the feed package never published in its `exports` — and
**declares** the dependency. That declaration is deliberate: with the import undeclared, turbo only
reported "undeclared import"; now it reports the real rule, `module` may not depend on `module`, from
the tag allowlist. `pnpm boundaries:negative` still rejects the fixture on both layers.

**4. The isolation gate retargeted with nothing lost.** `isolation.test.ts`'s list, detail, empty,
disabled, blocked, host-mismatch and platform-identity cases all moved from `/v1/example/items` to
`/v1/feed`. The disabled case needed a NEW throwaway tenant with the feed off, because the tenant it
used to ride on (tria-lab) lacks the reference module but HAS the feed. A positive control was added
to case `b` (the tenant's own ids are 200) so the 404s cannot pass vacuously.

**5. The forward-only removal migration (`5e74cac`).** One file, three statements in the only order
that works — rows, then table, then the narrowed CHECK — because the narrowed constraint is validated
against existing rows at creation time and would refuse to be created while the demo tenant still
carried the retired key. The pg-boss queue and its jobs go too, guarded by `to_regclass` so a cold
`supabase db reset` (where the worker has not yet created the `pgboss` schema) is a no-op rather than
a failed migration. The generated snapshot is untouched, so `pnpm db:generate` answers
"No schema changes"; only the journal TAG was renamed so the filename reads as what the file is.

**6. The phase-4 smoke witness (`8f53ae5`).** Four tests × two projects, all green: the ENABLED
witness (feed widget with the tenant's own seeded posts, no nav tab per D-55, `/post/{id}` renders),
the DISABLED witness (kernel welcome and "Em breve" render, no feed region, **no error card**, and
three feed routes answer 404 `MODULE_DISABLED` — never 403), the FLIP (widget appears within the
flags cache window, observed delay annotated, assertion exact), and the TRACE check (the deleted
module's former route answers not-found and the shell offers neither tab nor widget).

**7. The exit gate, run once, green (T3).** See below.

## The exit gate against the Phase 3 baseline

`pnpm verify` — **exit 0, 21m51s (1311s)**, no step skipped, no assertion weakened.

| Suite | Phase 3 baseline (03-08) | Phase 4 (this run) | Δ |
|---|---|---|---|
| unit (`turbo test`) | 385 | **512** (ui 68, contracts 57, module-feed 99, core 190, api 16, web 82) | +127 |
| pgTAP (`supabase test db`) | 128 | **191** (10 files) | +63 |
| integration | 313 | **373** (27 files) | +60 |
| e2e | 271 passed / 41 skipped | **328 passed / 58 skipped** | +57 |
| PWA e2e | 45 passed / 3 skipped | **45 passed / 3 skipped** | 0 |
| pooler spike | — | 3 passed | — |
| wall time | 20m26s | **21m51s** | +1m25s |

No suite's passed count is LOWER than the baseline. The PWA count is deliberately flat: Phase 4 added
no PWA case. The other four grew by roughly this phase's additions, and the wall time stayed in the
same order of magnitude.

Also green inside the gate: `check-ui-literals`, `check-static-routes` (32 guarded routes, `/post/[postId]`,
`/criar` and `/post/[postId]/editar` still dynamic), `pnpm boundaries` (475 files, 7 packages, no
issues), `pnpm boundaries:negative` (both layers reject), `guard:lanes`.

**Disk:** the first attempt ran with 3.4 GB free against a 7.4 GB `.turbo/cache`. Pruning that cache
and `apps/web/.next` (both gitignored, the documented 02-20 remedy — never the container stack)
restored 13 GB and the gate never came near the ENOSPC that killed the Phase 2 run.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 — Blocker] `apps/api/tests/integration/jobs.test.ts` imported the deleted module's queue constant**
- **Found during:** Task 1, at `pnpm turbo typecheck`
- **Issue:** `EXAMPLE_PROCESS_QUEUE` from `@tria/module-example/contracts`. The file is absent from the RESEARCH removal inventory.
- **Fix:** retargeted to `FEED_UNFURL_QUEUE`. What the file proves is the KERNEL's job wiring, so the owning module is incidental — and the assertions read `pgboss.queue` rather than trusting the constant, so the retarget keeps its teeth.
- **Commit:** `6f7631c`

**2. [Rule 1 — Bug] `apps/api/tests/integration/auth-middleware.test.ts` rode on the deleted route**
- **Found during:** Task 2, at `pnpm test:integration`
- **Issue:** the two invited-scope cases (c4, c5) and c4's positive control called `/v1/example/items`, which no longer exists — so a 403 assertion met a 404.
- **Fix:** retargeted to `/v1/feed`. The positive control was tightened from `not.toBe(403)` to `toBe(200)` while it was being touched (T-03-56: a negative without an exact positive can pass on a globally broken route).
- **Commit:** `5e74cac`

**3. [Rule 1 — Bug] `platform-tenants.test.ts` counted seven module rows**
- **Found during:** Task 2. Cases 12 and 13 asserted `7` rows per tenant; the vocabulary is now six.
- **Fix:** `6`, plus an explicit `toEqual([...TOGGLEABLE_MODULES].sort())` in case 1 so the count is tied to the list rather than to a literal that can drift again.
- **Commit:** `5e74cac`

**4. [Rule 1 — Bug] `apps/web/e2e/shell.spec.ts` asserted the deleted module's tab and widget**
- **Found during:** Task 3, **by the exit gate** — which is what it is for. Both seed-tenant cases named it: the demo case expected `Início · Exemplo · Perfil` and a visible `#exemplo`, and the lab case was framed as "the tenant WITHOUT that tab". Not in the RESEARCH inventory.
- **Fix:** both cases now assert `['Início','Perfil']` and the feed region as the rendered slot. The docblock records why that sameness is not a weakened assertion — what still separates the two tenants is the brand token, the logo, the display name and the adjacency check that neither tenant's brand appears in the other's HTML.
- **Commit:** `7788eda`

**5. [Rule 2 — Missing critical] `setTenantModuleFlag` existed only inside `phase2-smoke.spec.ts`**
- Both smokes needed it. Lifted into `tenant-fixtures.ts` as one implementation; two copies would have drifted on the `ON CONFLICT` clause.
- **Commit:** `8f53ae5`

**6. [Rule 2] The isolation gate gained a fourth fixture tenant**
- The disabled-module case had no tenant to run against once the reference module was gone (tria-lab has the feed). A throwaway tenant with `feed` explicitly `false` was added rather than dropping the case.
- **Commit:** `6f7631c`

### Plan-contract deviations (recorded, not "fixed" by weakening anything)

**7. `pnpm boundaries:negative` must exit ZERO, not non-zero.** Task 1's acceptance criterion and
`<fails_when>` both require a NON-zero exit. That inverts the script's actual contract:
`scripts/check-boundaries.sh` wraps the inversion itself and exits **0** when both layers correctly
reject the fixture. It also contradicts the plan's own exit gate, since `pnpm verify` chains
`&& pnpm boundaries:negative`. **Resolution:** the underlying intent is satisfied and was verified
directly — `turbo boundaries --filter=@tria/boundary-fixture` exits 1 with two issues (app dependency
and module→module), and Biome exits 1 on `noRestrictedImports`. Nothing was relaxed to get there.

**8. `grep -c "example" apps/web/e2e/phase4-smoke.spec.ts` is 3, not 0.** That criterion conflicts
with the plan's own `<behavior>` bullet — *"The reference module leaves no trace a browser can see:
its former route answers not-found"* — which cannot be asserted without naming the route. **Resolution:**
the substantive behaviour contract wins. Test 4 asserts `/v1/example/items` → 404 and that the shell
offers no `Exemplo` tab or `#exemplo` widget. Obfuscating the literal to satisfy a grep would be
gaming the check, which is the class of move this plan's prohibitions exist to stop.

**9. `grep -rl "example_items" supabase/` cannot print only the removal migration.** Migration history
is forward-only: the creating migration `20260913151120_example_items.sql`, its journal tag and the
sixteen drizzle snapshots taken before this one are immutable records of what was applied. Editing
them would rewrite applied history and break `db:reset` reproducibility. **Resolution:** the
enforceable intent — no LIVE reference — is met and was verified:
`grep -rn example_items apps packages scripts supabase/tests supabase/config.toml` returns nothing,
and the NEW snapshot (`meta/20260923035937_snapshot.json`) does not contain it.

**Total deviations:** 6 auto-fixed (1 blocker, 3 bugs, 2 missing-critical), 3 plan-contract
discrepancies recorded without weakening any assertion.
**Impact:** four of the six auto-fixes were files the RESEARCH removal inventory missed
(`jobs.test.ts`, `auth-middleware.test.ts`, `shell.spec.ts`, and the row counts in
`platform-tenants.test.ts`). All four were caught by the gates rather than by inspection, which is
the argument for running typecheck, integration and the full e2e rather than trusting a grep-built
inventory.

## Known Stubs

None introduced.

## Known-blocked verifications (carried to phase UAT, NOT counted as passing)

These cannot be run locally and are written down rather than quietly treated as green:

| # | Verification | Why blocked |
|---|---|---|
| 1 | A REAL video transcode | Deferred cloud phase 01.1 (no Mux credentials locally; the local provider is the fake). |
| 2 | Real-device HLS playback | Same — needs a real `playback_id` from a real transcode. |
| 3 | The native OS share sheet carrying `/post/{id}` on the tenant's own host | 04-08: an OS-level sheet is outside the browser automation boundary. Manual device check. |
| 4 | Double-tap-to-like (count +1, never +2) and gallery swipe-through on real iPhone/Android hardware | Touch gestures on real hardware; the Playwright mobile project emulates a viewport and touch, not the OS gesture recognisers. |
| 5 | Sketch 002 design-team approval | WINDOWS 28, carried from 04-04. Deltas are follow-up polish (02-04 precedent), not phase blockers. |
| 6 | The four Phase 2 UAT items blocked on the deferred cloud setup | Pre-existing; unchanged by this plan. |

Also carried, unfixed and out of scope (logged to `deferred-items.md` §5 and to the WINDOWS ledger):
`feed-composer.spec.ts:125` timed out inside the FIRST full gate run (`processing=2` — the worker was
not draining `kernel.media-derive-variants`), passes alone in 6.4 s, and passed in the SECOND full
gate run with nothing about it changed between the two. Same class as the already-logged
`platform-branding.spec.ts:182` and `feed.spec.ts` order-dependence: several specs spawn and stop
their own worker via `ensureWorker()`. Nothing in this plan's diff touches media derivation.

## Threat Flags

None. This plan removes surface rather than adding it. The three registered threats were all
mitigated as planned: T-04-61 (the isolation gate never lost a worked case — the feed substitution
was asserted present by Task 1's precondition, `grep -c feed_posts` 030=6 / 020=11, before anything
was dropped), T-04-62 (the negative boundary check is stronger, not vacuous), T-04-63 (both widened
paths removed, the surviving rule asserted in three places), T-04-64 (the migration applied from a
cold reset in the required order), T-04-65 (the six blocked verifications above are listed rather
than counted).

## Next

Phase 4 plan 10 of 10 complete. The phase's plan-level work is done; phase close-out
(verification, `phase.complete`, the ROADMAP phase checkbox) belongs to the orchestrator.

## Self-Check: PASSED

- `apps/web/e2e/phase4-smoke.spec.ts` — FOUND
- `supabase/migrations/20260923035937_drop_example_module.sql` — FOUND
- `packages/modules/example` — correctly ABSENT (`git ls-files` empty)
- Commits `6f7631c`, `5e74cac`, `8f53ae5`, `7788eda` — all FOUND in `git log`
- `commits: 4` MEASURED via `git rev-list --count 9c72952..HEAD`
- `pnpm verify` exit 0 re-verified end to end
