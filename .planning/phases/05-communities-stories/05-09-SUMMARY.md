---
phase: 05-communities-stories
plan: 09
subsystem: api
tags: [communities, media-assets, tenant-isolation, rls, existence-oracle, tdd, gap-closure]

# Dependency graph
requires:
  - phase: 05-01
    provides: "the communities module — contracts, service, routes, the closed COMMUNITY_ISSUES vocabulary and the bare-404 posture"
  - phase: 05-04
    provides: "COMM-01's write half — createCommunity/updateCommunity, CommunityForm, the write actions and the inert no-op PATCH contract"
provides:
  - "resolveCoverAsset — one in-transaction cover resolution shared by the create and the update path"
  - "a bare 404 for a foreign, unknown or soft-deleted cover id, byte-identical to an unknown uuid's"
  - "the closed cover_invalid code for a real asset of this tenant that cannot serve as a cover"
  - "isolation.test.ts case b5 — the cross-tenant cover gate with its same-tenant positive control"
  - "communities.test.ts cases 27-32 — the same-tenant cover refusal battery"
  - "coverAwareRefusal — the BFF's fact-based attribution of a bare 404 to the cover"
affects: [05-10, 05-11, 05-12, phase-06, media, communities]

actuals:
  tokens: 45877
  tasks: 3
  # MEASURED from plan_head_before: 5 task commits + this plan's own docs commit.
  commits: 6

plan_head_before: 249962d5b58100ea5a5a715e80126ba69809f1cb

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-table reference validation for a client-supplied id happens at the SERVICE layer inside the writing transaction — never via a composite foreign key, whose refusal arrives as a 23503 and surfaces as a 500 (the oracle shape)"
    - "Two refusal answers, split by what the caller already knows: a MISS is one bare 404 with no details; an UNUSABLE row of this tenant is a closed machine code"
    - "The BFF disambiguates two deliberately identical 404s by a FACT (no id was sent / the resource re-reads), never by comparing against a remembered client value"

key-files:
  created:
    - "apps/web/app/(app)/comunidades/actions.test.ts"
  modified:
    - "packages/modules/communities/server/service.ts"
    - "packages/modules/communities/contracts/index.ts"
    - "apps/api/tests/integration/isolation.test.ts"
    - "apps/api/tests/integration/communities.test.ts"
    - "apps/web/app/(app)/comunidades/actions.ts"
    - "apps/web/app/(app)/comunidades/CommunityForm.tsx"
    - "apps/web/messages/pt-BR/communities.json"

key-decisions:
  - "No composite (tenant_id, id) foreign key on media_assets: the plan's assumption-delta decision was honoured as written — the cover reference is hardened at the service layer only, no Drizzle schema file and no migration was touched"
  - "The accepted cover tuple is exactly (purpose 'cover', kind 'image', status 'ready'); the feed's D-53 processing concession is a VIDEO concession and is deliberately not inherited"
  - "Cover validation runs on every PATCH whose resolved cover is non-null — including one that re-sends the stored id — placed BEFORE the changedContent comparison so the no-op write stays observably inert"
  - "asCommunityIssue now narrows against the contract's exported COMMUNITY_ISSUE_SET instead of a hand-written disjunction, so the vocabulary has exactly one definition"
  - "The edit-screen 404 is attributed to the cover by RE-READING the community with loadCommunity, not by comparing the submitted cover against the one the form loaded — the comparison is falsified by a stored bad id re-sent unchanged (case 31)"

patterns-established:
  - "Tracer feedback gate on a security fix: the cross-tenant case is written and proven RED before the service is touched, so the fix is verified against the exact defect rather than against a belief about it"
  - "Fixture cleanup orders referencing rows before referenced rows, keyed on ids rather than names, so a crashed run cannot wedge the next one on a foreign key"

requirements-completed: [COMM-01]

coverage:
  - id: D1
    description: "createCommunity and updateCommunity resolve the client-supplied coverAssetId against media_assets inside the same withTenantTx, before the row is written"
    requirement: "COMM-01"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#b5. covers: a demo admin cannot point a community at the lab's asset, and learns nothing by trying (05-09)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A foreign, unknown or soft-deleted cover id is refused with ONE bare 404 carrying no details key, byte-identical to the answer an unknown uuid gets"
    requirement: "COMM-01"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#b5 (JSON.stringify equality between the foreign-cover and unknown-uuid bodies)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A real asset of this tenant with the wrong purpose, the wrong kind or a non-ready status is refused 400 VALIDATION_FAILED with the closed cover_invalid code, identically on both write verbs"
    requirement: "COMM-01"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#27, #28, #29"
        status: pass
    human_judgment: false
  - id: D4
    description: "COMM-01 edges: null/absent cover performs no lookup and stores null; a repeat PATCH stays inert yet still validates; uuid equality is Postgres, and a malformed id is a 400 from the contract validator, never a 500"
    requirement: "COMM-01"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#30, #31, #32"
        status: pass
    human_judgment: false
  - id: D5
    description: "A refused cover reaches the admin as its own pt-BR sentence — on the create screen, and on the edit screen including the case where the bad id was already stored and re-sent unchanged"
    requirement: "COMM-01"
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/comunidades/actions.test.ts (7 cases)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts (34 pre-existing cases, regression gate over the edited form and actions)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The refusal copy renders in the CommunityForm alert card as designed (UI-SPEC error/E13) and reads correctly in pt-BR on a real phone viewport"
    verification: []
    human_judgment: true
    rationale: "The sentence's tone and its placement in the alert card are a visual/editorial judgment; the automated gates prove the code reaches the card and that the string lives in the catalog, not that it reads well."

# Metrics
duration: 25min
completed: 2026-09-24
status: complete
---

# Phase 05 Plan 09: Cover-Asset Tenant Gate Summary

**The community cover reference is now resolved inside the writing transaction: a foreign, unknown or soft-deleted asset id answers one bare 404 that is byte-identical to an unknown uuid's, an unusable asset of this tenant answers the closed `cover_invalid` code, and the 23503-vs-201 cross-tenant existence oracle is gone.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-24T11:28:00Z
- **Completed:** 2026-09-24T11:52:00Z
- **Tasks:** 3
- **Files modified:** 8 (7 modified, 1 created)

## Accomplishments

- **GAP 1 of `05-VERIFICATION.md` is closed.** `createCommunity` and `updateCommunity` interpolated the client's `coverAssetId` straight into SQL with no `SELECT` against `media_assets`. The single-column foreign key could not save it — Postgres referential integrity runs as the table owner and therefore bypasses RLS — so another tenant's asset id persisted, and the 23503-vs-201 split (random uuid → unhandled 500; real foreign id → 201) was a working cross-tenant existence oracle over an enumerable uuid space.
- **One shared resolution, not two copies.** `resolveCoverAsset` issues a single indexed lookup inside the caller's transaction and is called by both write paths — as the FIRST statement of `insertCommunity`, and in `updateCommunity` before the `changedContent` comparison. Nothing in the file compares tenant ids, so the cross-tenant answer falls out of the same code path as an unknown id (the `publishStory` idiom, matched rather than reinvented).
- **The refusal split matches what the caller already knows.** No row, for any reason, is `ApiError(404, 'NOT_FOUND')` with no third argument. A row that IS present but is not `(cover, image, ready)` is `400 { community: 'cover_invalid' }`.
- **The cross-tenant case now exists where the gate lives.** `isolation.test.ts` case b5 probes a create and an update from the demo admin at the lab's cover, asserts no `details` key at all, asserts the two refusal bodies equal by `JSON.stringify` (minus `requestId`), asserts nothing was written and the lab's row is untouched — and closes with the same-tenant 201 positive control in the same `it()`.
- **The admin is told the truth.** A bare 404 on a submission carrying a cover is attributed to the cover by a FACT: on a create no community id was sent, so nothing else can be missing; on an edit the action re-reads the community and answers `cover_invalid` only when it still reads back.

## Task Commits

1. **Task 1 (tracer, TDD): end-to-end "a foreign cover id is refused"**
   - RED: `78de844` (`test(5-9)`) — case b5, failing on `expected 201 to be 404`
   - GREEN: `e0850a2` (`feat(5-9)`) — `resolveCoverAsset`, both call sites, `cover_invalid` in the contract
2. **Task 2 (TDD, test-only): the same-tenant refusal battery** — `fa5cd4c` (`test(5-9)`), cases 27-32
3. **Task 3 (TDD): the form says something true**
   - RED: `a413b91` (`test(5-9)`) — `actions.test.ts`, 3 of 7 cases failing on the planned assertions
   - GREEN: `36424a6` (`feat(5-9)`) — `coverAwareRefusal`, `COMMUNITY_ISSUE_SET` narrowing, the catalog sentence and the `messageFor` arm

No REFACTOR commit: neither GREEN produced anything worth cleaning up, and a commit that changes nothing is noise in a bisect.

## TDD Gate Compliance

| Task | RED | GREEN | REFACTOR | Status |
|------|-----|-------|----------|--------|
| 1 | ✓ `78de844` | ✓ `e0850a2` | — | Pass |
| 2 | n/a | n/a | — | Exempt (test-only) |
| 3 | ✓ `a413b91` | ✓ `36424a6` | — | Pass |

**RED evidence was produced from real runs and machine-verified, never hand-written.** Vitest emits no TAP and this repo wires no TAP reporter, so each RED run was captured with `--reporter=json --outputFile=…` and normalised into the checker's record shape by a **throwaway** script under the session scratchpad (deleted; it is not a project artifact and appears in no commit). Both records returned `RED_EVIDENCE_OK / target_test_failed`:

- Task 1: `exit 1`, 23 tests, 1 fail; target `…b5. covers…` — expected `404`, actual `201`.
- Task 3: `exit 1`, 7 tests, 3 fail; target `…attributes the bare 404 to the cover when the submission carried one` — expected `cover_invalid`, actual `not_found`.

**Task 2 is exempt and this is recorded rather than glossed.** Its `<files>` names only `apps/api/tests/integration/communities.test.ts` — a test-only task with no source file, so the behaviour-adding predicate is false and no RED gate applies. Its six cases went green on first run because the behaviour they characterise was delivered by Task 1's own RED→GREEN cycle, which is the ordering the plan specified. Cases 27, 28, 29 and 31 would have been red against the pre-fix service; no attempt was made to manufacture that after the fact.

## Files Created/Modified

- `packages/modules/communities/server/service.ts` — `resolveCoverAsset` + its `CoverAssetRow` type; called as the first statement of `insertCommunity` and before `changedContent` in `updateCommunity`. Both `log.info` calls still record `hasCover` as a boolean and nothing was added: the refusal throws before either.
- `packages/modules/communities/contracts/index.ts` — `cover_invalid` is the third member of the closed `COMMUNITY_ISSUES`; the docblock now states what it means and why the MISS is still deliberately absent.
- `apps/api/tests/integration/isolation.test.ts` — the `seedCover` fixture helper, one usable cover per tenant, case b5, and a cleanup that deletes communities referencing fixture assets before the assets themselves.
- `apps/api/tests/integration/communities.test.ts` — the cover-asset contract block (cases 27-32) with its own fixtures and afterAll.
- `apps/web/app/(app)/comunidades/actions.ts` — `coverAwareRefusal`, called by both write actions; `asCommunityIssue` narrows against `COMMUNITY_ISSUE_SET`.
- `apps/web/app/(app)/comunidades/CommunityForm.tsx` — the `case 'cover_invalid':` arm in `messageFor`. No ref, no captured value, no comparison was added.
- `apps/web/messages/pt-BR/communities.json` — `errors.coverInvalid`.
- `apps/web/app/(app)/comunidades/actions.test.ts` *(new)* — seven cases pinning the attribution rule.

## Decisions Made

- **The assumption-delta `no-change` was honoured exactly.** No unique index on `media_assets(tenant_id, id)`, no composite foreign key, no migration. `git status --porcelain -- supabase/migrations packages/modules/communities/db packages/core/db/schema` prints nothing.
- **`status = 'ready'` is required for a cover.** The feed's D-53 concession exists because a transcoding video renders a `processando` placeholder; a cover has no such placeholder and would render as exactly the `--brand-gradient` block the admin was replacing. Case 29 pins it with a comment naming what is deliberately not inherited.
- **The PATCH lookup sits before the no-op early return, not after.** A bad id a pre-fix release wrote must not survive by being re-sent unchanged. Case 31 proves both halves: the repeat PATCH moves no `updated_at` and emits no event, and the same PATCH against a hand-corrupted row is refused.
- **The wire stays indistinguishable; the BFF does the telling apart.** The server was not weakened to make the client's job easier.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `actions.test.ts` needed an `@/lib/env` stub to load at all**
- **Found during:** Task 3 (RED phase)
- **Issue:** The first RED run reported `Invalid environment variables` and discovered **zero** tests — `lib/env` validates the process environment at import time and the web vitest config, unlike the API's, loads no `.env.local`. That is an `INVALID_RED` (`fixture_or_load_failure`), not a RED, and it must not authorise a GREEN edit.
- **Fix:** Mocked `@/lib/env` in the test, exactly as `apps/web/lib/tenant-host.test.ts` already does.
- **Files modified:** `apps/web/app/(app)/comunidades/actions.test.ts`
- **Verification:** The re-run discovered 7 tests and failed 3 on the planned assertions; `check tdd-red-evidence` then returned `RED_EVIDENCE_OK`.
- **Committed in:** `a413b91` (Task 3 RED commit)

**2. [Rule 2 - Missing Critical] Fixture cleanup ordered around the cover foreign key**
- **Found during:** Task 1 (RED phase) and Task 2
- **Issue:** `isolation.test.ts`'s `afterAll` deletes every fixture `media_assets` row. Once a community points at one, that delete fails on the foreign key — and during a RED run the failing case legitimately leaves behind exactly such a row. The plan did not specify the ordering.
- **Fix:** Both files now delete communities whose `cover_asset_id` is any fixture asset (keyed on ids, not names) before deleting the assets. `communities.test.ts`'s block-local `afterAll` does the same so it cannot race the file-level sweep.
- **Files modified:** `apps/api/tests/integration/isolation.test.ts`, `apps/api/tests/integration/communities.test.ts`
- **Verification:** The full integration suite ran clean twice (479 passed) with no leftover rows.
- **Committed in:** `78de844` and `fa5cd4c`

**3. [Rule 1 - Bug] `apps/web/app/(app)/comunidades/actions.test.ts` is a file the plan did not list**
- **Found during:** Task 3
- **Issue:** Task 3 is `tdd="true"` and behaviour-adding (it edits source files), but the plan's `files_modified` named no test file, so there was nothing to go RED on. Its declared `<verify>` runs `pnpm --filter @rede-social/web test`, which implies a unit surface for this behaviour.
- **Fix:** Added the seven-case unit test. It is additive, mocks only `lib/communities` and `lib/env`, and exercises the real schemas and the real refusal mapping.
- **Files modified:** `apps/web/app/(app)/comunidades/actions.test.ts` (new)
- **Verification:** RED verified, then green; the whole web unit suite is 119/119.
- **Committed in:** `a413b91`

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 missing-critical, 1 test-surface). **Impact on plan:** none on scope — no schema change, no new package, no new route. The first two were required to get a valid RED at all; the third is what makes Task 3's TDD gate real rather than nominal.

## Verification Evidence

Every gate in the plan's `<verification>` block was run and exits 0:

| Gate | Result |
|---|---|
| `pnpm --filter @rede-social/module-communities typecheck && lint` | pass |
| `pnpm --filter @rede-social/api typecheck && lint` | pass |
| `pnpm --filter @rede-social/web typecheck && lint` | pass |
| `bash scripts/check-ui-literals.sh` | pass ("no hex/legacy-class/pt-BR literals in .tsx") |
| `pnpm boundaries` | pass (552 files, 9 packages, no issues) |
| `pnpm db:reset && pnpm db:seed && pnpm test:integration` | **479 passed / 29 files**, including b5 and 27-32 |
| `pnpm --filter @rede-social/web test` | 119 passed / 14 files |
| `pnpm --filter @rede-social/web build && bash scripts/check-static-routes.sh` | pass, **offenders: 0**, 39 guarded routes |
| `pnpm --filter @rede-social/web exec playwright test comunidades.spec.ts` | **34 passed** (the shipped walk, unbroken) |
| `git status --porcelain -- supabase/migrations …/db …/schema` | empty — no schema file, no migration |

Source-level acceptance criteria (all met): `cover_invalid` appears 3× in the contract; `from media_assets` appears exactly **1×** in non-comment service code (one shared resolution); `resolveCoverAsset` appears **3×** (declaration + one call per write path); `app.tenant_id|withAdminTx|service_role` appears **0×** (the lookup stays in the tenant lane, T-05-42); `Object.hasOwn` appears 4× in `isolation.test.ts`; `cover_invalid` appears 7× in `communities.test.ts`; `coverInvalid` appears once in the catalog and once in the form, and zero pt-BR cover literals live in `.tsx`.

## Known Stubs

None. No hardcoded empty value, placeholder string or unwired data source was introduced, and no test was skipped or left unrun.

## Threat Flags

None. This plan adds no network endpoint, no auth path, no file-access pattern and no schema change at a trust boundary — it removes a realised one. The register's five mitigations (T-05-40…T-05-43, T-05-SC) are all discharged by the evidence above; T-05-44 (the extra indexed SELECT per community write) was accepted as planned and no package install occurred.

## Issues Encountered

- **`pnpm test:integration -- isolation` does not filter.** The trailing argument is not forwarded as a vitest name filter, so the command runs all 29 integration files. That is a superset of what the plan asked for, so it was accepted rather than worked around; the targeted RED run used `pnpm --filter @rede-social/api exec vitest run tests/integration/isolation.test.ts -t "b5."` directly.
- **The `check tdd-red-evidence` checker consumes TAP, which Vitest does not emit.** Resolved with a throwaway JSON→TAP normaliser in the session scratchpad, deleted after use. Worth knowing before the next TDD plan in this repo.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- GAP 1 is closed on all four of the verifier's `missing:` items. The remaining gap-closure plans (05-10, 05-11, 05-12) are unaffected by anything here: this plan touched no story, pin or feed code path.
- One item is left for a human in the phase UAT: D6, whether the new pt-BR sentence reads well in the alert card on a phone. Everything else in this plan is machine-proven.

---
*Phase: 05-communities-stories*
*Completed: 2026-09-24*

## Self-Check: PASSED

All 9 files named above exist on disk; all 5 task commits (`78de844`, `e0850a2`, `fa5cd4c`, `a413b91`, `36424a6`) are present in the git log. The throwaway RED-evidence normaliser lives only in the session scratchpad and is in no commit.
