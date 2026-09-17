---
phase: 02-tenant-shell-branding-platform-panel
plan: 17
subsystem: platform
tags: [domains, platform, jobs, pg-boss, gap-closure, poller, drizzle]

# Dependency graph
requires:
  - phase: 02-09
    provides: checkDomain (the ONE check route/restart/job share), enqueueVerify (singletonKey = domainId, startAfter 600 s, short policy), fake provider host switches, platform-domains integration suite
  - phase: 02-05
    provides: sendPendingInvites (claim-before-send) used by ensureVerifiedSideEffects
provides:
  - "checkDomain provider-error branch: last_error = '<kind>[:<status>]' + last_checked_at, expired when verify_deadline_at passed, otherwise enqueueVerify inside the same admin transaction; update guarded by verified_at is null (CR-01, VERIFICATION truth #9)"
  - "ensureVerifiedSideEffects(): Promise<boolean> + clearLastErrorIfSettled(domainId) — last_error cleared after a fully successful re-run in the already_verified AND verified branches (WR-01)"
  - "fake provider 'provider-fails-once' host switch — the poller's error path is reachable locally and in CI"
  - "platform-domains integration cases 17-20 (re-arm, next-run verifies, error-path expiry + 409 + restart, last_error clear) and a domains-fake unit case"
affects: [02-verification, phase-08-hardening, domains-poller, platform-panel-dominios]

# Actuals (#2632) — same estimateTokens scale as the plan's estimate (chars/4 over the files actually changed)
actuals:
  tokens: 17341
  tasks: 2
  commits: 2
plan_head_before: b4851d06ae1d33b6da22419372f7c45ade6ef6ca

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Poller error branch = normal outcome: record the error, apply the deadline, re-arm in the SAME transaction; never a silent dead end"
    - "Side-effect runner reports success as a boolean; the caller clears the recorded error only on true (conditional `where last_error is not null` update)"
    - "Deterministic fake-adapter failure switch keyed by host substring + module-level once-set (provider-fails-once)"

key-files:
  created: []
  modified:
    - packages/core/server/platform/domains.ts
    - packages/core/server/domains/fake.ts
    - packages/core/tests/domains-fake.test.ts
    - apps/api/tests/integration/platform-domains.test.ts

key-decisions:
  - "02-17: a thrown domainProvider.verify is a normal poller outcome — checkDomain evaluates verify_deadline_at first (expired, nothing re-armed) and otherwise records last_error = '<kind>[:<status>]' and enqueueVerify(tx, domainId) inside the same admin transaction, guarded by verified_at is null; verify-job.ts keeps its crash re-arm for THROWN errors only"
  - "02-17: ensureVerifiedSideEffects returns a boolean and both checkDomain branches (already_verified and verified) clear last_error via clearLastErrorIfSettled only when BOTH side effects succeeded — a failed side effect keeps or re-records its error so the Domínios card keeps offering 'Verificar agora'"
  - "02-17: the fake provider's 'provider-fails-once' switch is a module-level Set<string> of hosts that already threw (first verify -> DomainProviderError('unavailable', 503), later calls normal); counters shape and fakeDomainProviderStats() unchanged"
  - "02-17: IN-01..IN-07 (review Info items) remain deferred to Phase 8 hardening — product-owner decision 2026-09-17, none contradicts a Phase 2 must-have"

patterns-established:
  - "Error-path re-arm: `update … where id = $1 and verified_at is null returning` + `if (rows[0] && !expired) enqueueVerify(tx, …)` in one withAdminTx"
  - "Conditional clear: `update … set last_error = null where id = $1 and last_error is not null` (no-op safe on every path)"

requirements-completed: [TENANT-07]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "CR-01 re-arm: a throwing provider keeps the host pending, records last_error = 'unavailable:503' and re-arms ONE new created kernel.domain-verify job (start_after >= 590 s) in the same transaction; the next run verifies (verified_at set, last_error null, by-host 200, invite sent, no further re-arm)"
    requirement: TENANT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-domains.test.ts#17. a throwing provider keeps the host pending, records last_error = \"unavailable:503\" and re-arms ONE new created job >= 590 s ahead in the same transaction"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/platform-domains.test.ts#18. the next run verifies the host (the fake answers OK now): verified_at set, last_error cleared, by-host 200, invite sent, and no further re-arm"
        status: pass
      - kind: unit
        ref: "packages/core/tests/domains-fake.test.ts#provider-fails-once: the FIRST verify throws DomainProviderError(unavailable, 503), the second verifies; other hosts never throw (CR-01 error-path seam)"
        status: pass
    human_judgment: false
  - id: D2
    description: "CR-01 expiry on the error path: past verify_deadline_at a throwing provider marks the host expired, re-arms nothing, the verify route answers 409 { reason: 'expired' } and restart -> 200 verified"
    requirement: TENANT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-domains.test.ts#19. past verify_deadline_at a throwing provider marks the host expired on the error path and re-arms nothing; verify answers 409 { reason: \"expired\" }; restart -> 200 and verifies"
        status: pass
    human_judgment: false
  - id: D3
    description: "WR-01: a verified host with last_error = 'allow_list' answers lastError null after POST …/verify (200, no provider call, verified_at unchanged, DB column null); a verified host without an error also answers lastError null"
    requirement: TENANT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-domains.test.ts#20. WR-01: a verified host with a side-effect last_error answers lastError null after a successful re-run (\"Verificar agora\": no provider call, verified_at unchanged); without an error the clear is a no-op"
        status: pass
    human_judgment: false
  - id: D4
    description: "Regression guard: cases 1-16, every kernel unit file and every other integration file stay green after the error-branch and side-effect changes"
    requirement: TENANT-07
    verification:
      - kind: integration
        ref: "pnpm test:integration -- platform-domains jobs worker (16 files, 180 tests)"
        status: pass
      - kind: unit
        ref: "pnpm --filter @tria/core test (15 files, 117 tests) && pnpm --filter @tria/api test (3 files, 15 tests)"
        status: pass
    human_judgment: false

# Metrics
duration: 8 min
completed: 2026-09-17
status: complete
---

# Phase 02 Plan 17: Domain Poller Error-Path Re-arm + last_error Clear (CR-01, WR-01) Summary

**`checkDomain` now survives a throwing provider — records `last_error = '<kind>[:<status>]'`, expires past the 7-day deadline or re-arms the `kernel.domain-verify` job inside the same admin transaction — and clears `last_error` once the verified side effects succeed, so the Domínios card stops offering "Verificar agora" after a successful retry**

## Performance

- **Duration:** 8 min
- **Started:** 2026-09-17T13:15:15Z
- **Completed:** 2026-09-17T13:23:15Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- **CR-01 closed (VERIFICATION truth #9):** the `catch` around `domainProvider.verify` in `checkDomain` computes `expired = verifyDeadlineAt < now`, runs ONE `withAdminTx` that updates `lastCheckedAt` + `lastError` (+ `verificationStatus: 'expired'` when past the deadline) guarded by `and(eq(id), isNull(verifiedAt))`, and calls `enqueueVerify(tx, domainId)` in the same transaction when a row came back and the deadline has not passed. Outcome is `'expired' | 'pending'`; the log keeps the `platform.domains.check_failed` event with `kind`, `status`, `expired` and the messages `'provider check failed; poller re-armed'` / `'provider check failed; deadline passed; poller stopped'`.
- **Error path reachable locally and in CI:** the fake provider gained the `provider-fails-once` host switch (module-level `Set<string>`; first `verify` throws `DomainProviderError('unavailable', 503)`, later calls answer normally). `counters` / `fakeDomainProviderStats()` unchanged.
- **WR-01 closed:** `ensureVerifiedSideEffects` returns `true` only when neither the allow-list add nor `sendPendingInvites` entered its `catch`; `clearLastErrorIfSettled(domainId)` (`update … set last_error = null where id = $1 and last_error is not null`) runs on success in both the `already_verified` and the `verified` branch. `recordError`, the `verified_at` single writer and the side-effect order are untouched.
- **Pinned end to end:** new describe `'poller — provider-error path re-arms and expires (CR-01, D-34)'` (tenant `pd-err-<run>`, cases 17-20) plus one `domains-fake` unit case. `verify-job.ts`, `boss.ts` and every schema file unchanged (no migration).

## Observed evidence (for the verifier's re-check of truth #9)

| Step | `last_error` | `created` kernel.domain-verify rows for the domain | Row state |
|------|--------------|-----------------------------------------------------|-----------|
| case 17 — attach `provider-fails-once-<run>.cliente.test`, attach job marked `completed` | `null` | 0 (before the run) | pending |
| case 17 — handler run 1 (fake throws) | `'unavailable:503'` | **1 NEW row**, `start_after - now >= 590 s`; fake `verify` counter +1 | pending, `last_checked_at` set |
| case 18 — handler run 2 (fake answers OK) | `null` | 1 (unchanged — no re-arm after verified) | verified, by-host 200, invite `sent` |
| case 19 — second host, attach job completed, `verify_deadline_at = now() - 1h`, handler run (fake throws) | `'unavailable:503'` | 0 | **expired**, `last_checked_at` set; `POST …/verify` → 409 `DOMAIN_STATE_INVALID { reason: 'expired' }`; `POST …/restart` → 200 `verified` |
| case 20 — verified host seeded with `last_error = 'allow_list'`, `POST …/verify` | `null` (API body and DB column) | — | verified, `verifiedAt` unchanged, fake `verify` counter unchanged; second verify without an error also `lastError: null` |

`pnpm test:integration -- platform-domains jobs worker` was green **one shot** after each task (16 files / 179 tests after Task 1, 16 files / 180 tests after Task 2). The tracer feedback gate (row 3: interactive, `end-of-phase`, automated-only verify) re-ran the full Task 1 chain before Task 2 — green.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "provider error re-arms the poller and honours the deadline" (tracer)** — `1b52373` (fix)
2. **Task 2: WR-01 — ensureVerifiedSideEffects reports success and the callers clear last_error** — `a095736` (fix)

**Plan metadata:** see the docs commit that follows this SUMMARY.

## Files Created/Modified

- `packages/core/server/platform/domains.ts` — `checkDomain` provider-error branch rewritten (deadline check, single guarded update, in-transaction `enqueueVerify`, `outcome: 'expired' | 'pending'`); `ensureVerifiedSideEffects(): Promise<boolean>`; new `clearLastErrorIfSettled`; both callers clear on success; docblocks updated; `isNotNull` imported.
- `packages/core/server/domains/fake.ts` — `provider-fails-once` switch + docblock bullet; imports `DomainProviderError`.
- `packages/core/tests/domains-fake.test.ts` — unit case for the switch (throws once with kind `unavailable` / status 503, then verifies; counter +2; other hosts never throw).
- `apps/api/tests/integration/platform-domains.test.ts` — `domainRow` selects `last_error`; helpers `completeJobsOf` / `createdJobsOf`; new describe with cases 17-20.

## Decisions Made

- A thrown provider call is a normal poller outcome handled inside `checkDomain` (deadline first, then re-arm in the same transaction); `domains/verify-job.ts` keeps its crash re-arm strictly for THROWN errors, so there is still exactly one re-arm per failure mode.
- `last_error` is cleared only when BOTH side effects succeeded, via a conditional update that is a no-op when nothing is set — safe to call on every path, and it keeps the answered row honest even when a `recordError` lands after the winning update's `lastError: null`.
- Kept the plan-specified log message `'provider check failed; deadline passed; poller stopped'` verbatim even though the pre-existing 02-09 message `'verification deadline passed; poller stopped'` shares the substring (see Issues).
- IN-01..IN-07 stay deferred to Phase 8 hardening (product-owner decision 2026-09-17, 02-VERIFICATION.md human item 12).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Two acceptance-criterion grep counts needed interpretation, no behaviour change:
  - `grep -c "DomainProviderError('unavailable', 503)" fake.ts` was 2 because the docblock repeated the literal; the docblock was reworded ("a `DomainProviderError` of kind `unavailable` with status 503") so the throw site is the single match (count = 1).
  - `grep -c "deadline passed; poller stopped" domains.ts` is 2, not 1: the pre-existing 02-09 message `'verification deadline passed; poller stopped'` (failed-check expiry branch) also contains the substring. The plan-named new message `'provider check failed; deadline passed; poller stopped'` appears exactly once; the old message was left alone (out of scope, pinned by 02-09 semantics).
- `pnpm --filter @tria/core test -- domains-fake` and `pnpm test:integration -- platform-domains` run their whole suites (filter args are not forwarded by these scripts, as 02-09 noted) — both were green, so the gates hold as written.

## Known Stubs

None.

## Threat Flags

None — the change stays inside the plan's threat register (T-02-140..144): re-arm paced by `startAfter` + `singletonKey` under `short`, `last_error` composed only from `kind`/`status`, error update guarded by `verified_at is null`, clear conditional on the boolean, test switch confined to the fake adapter.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 02-VERIFICATION.md truth #9 can be re-checked: throwing provider → `pgboss.job_common` has a `created` row keyed by the domain id (case 17); past deadline → `verification_status = 'expired'` (case 19).
- Remaining gap-closure plans of Phase 2 (02-18..02-20) are independent of this one (`depends_on: ["02-09"]` only).
- IN-01..IN-07 remain open for Phase 8 hardening.

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-17*

## Self-Check: PASSED
