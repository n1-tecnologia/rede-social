---
phase: 12-formulario-de-perfil-do-tenant
plan: 05
subsystem: auth
tags: [profile-form, gate, require-auth, bootstrap, D-581, D-584, D-585, D-589, tracer, error-code]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 02 names (profile_form, PROFILE_FORM_PENDING), plan 03 profileFormBootstrapSchema, plan 04 app.profile_form_missing, app.profile_form_missing_self and the _gate lookup twins"
  - phase: 09.1-acesso-por-gateway-de-pagamento
    provides: "the access-state refusal chain in requireAuth that the form refusal extends"
provides:
  - "Membership.profileFormMissing (required number) read from app.membership_in_tenant_gate / app.memberships_of_user_gate in the lookup's own statement"
  - "PROFILE_FORM_PENDING in ERROR_CODES and ERROR_MESSAGES; PROFILE_FORM_ALLOWED_PATHS and the last refusal of requireAuth"
  - "GET /v1/me/bootstrap additive optional profileForm { pendingRequired, newOptional }, absent for staff and for a module that is off"
  - "kernel file packages/core/server/profile-form/member.ts: liveModuleOn and bootstrapBlock (plan 06 extends it)"
  - "integration helpers withProfileForm, seedProfileFormQuestion, seedProfileFormAnswer, removeProfileFormByPrefix"
affects: [12-06, 12-07, 12-08, 12-09, 12-11, 12-14, 12-18, profile-form]

actuals:
  tokens: 12850
  tasks: 2
  commits: 2
plan_head_before: 567d0468bc9045ac73ef14ebefdff26cdb00bd31

tech-stack:
  added: []
  patterns:
    - "A refusal that rides the membership lookup row: the count is computed by SQL in the same statement, parsed as a non-negative integer, and a bad value is a 500 (a broken invariant), never 'not pending'"
    - "Exact-path allow-list compared with trailing slashes stripped, exported next to CUT_ALLOWED_PATHS"
    - "A bootstrap block derived from the same SQL rule as the gate plus a live module read, never from the 30-second flags cache"
    - "Integration case isolation by title prefix: afterEach removes the form so one case's required question never gates the next case's members"

key-files:
  created:
    - packages/core/server/profile-form/member.ts
    - packages/core/tests/require-auth-form.test.ts
    - apps/api/tests/integration/profile-form-gate.test.ts
  modified:
    - packages/core/server/tenancy/membership.ts
    - packages/core/server/auth/require-auth.ts
    - packages/contracts/src/errors.ts
    - packages/core/server/http/api-error.ts
    - packages/contracts/src/bootstrap.ts
    - apps/api/src/routes/me.ts
    - packages/core/tests/membership-pick.test.ts
    - packages/core/tests/require-auth-cut.test.ts
    - apps/api/tests/integration/setup.ts

key-decisions:
  - "The form refusal is asked only of an active membership: an invited membership that reaches the check is on /v1/me/invite or /v1/me/accept-invite, which are not on the form allow-list, so without this guard it could never accept its invitation. The invited-path set itself is unchanged."
  - "profile_form_missing is converted with an explicit type and blank check before Number(), because Number(null) and Number('') are 0 and would read a broken row as 'not pending'"
  - "The old _gated lookup pair is untouched and stays one release; the kernel now calls only the _gate pair"

patterns-established:
  - "The error code is the last element of the refusal chain and carries details.tenantName only"
  - "bootstrapBlock(tx, ctx) runs inside the bootstrap handler's existing withTenantTx and returns undefined for staff, so the key is absent rather than null"

requirements-completed: [PFORM-09, PFORM-10, PFORM-11, PFORM-12]

coverage:
  - id: D1
    description: "requireAuth refuses a member with profileFormMissing above zero with 403 PROFILE_FORM_PENDING (details.tenantName only), last in the chain, except on the three exact allowed paths"
    requirement: PFORM-10
    verification:
      - kind: unit
        ref: "packages/core/tests/require-auth-form.test.ts#1, 1b, 2, 3 (full refusal order), 5"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-gate.test.ts#12-05 tracer, precedence"
        status: pass
    human_judgment: false
  - id: D2
    description: "The count rides the lookup's own statement (one execute per lookup, columns from the _gate twins) and a negative, fractional, NaN, null, blank or non-numeric value is a throw"
    requirement: PFORM-09
    verification:
      - kind: unit
        ref: "packages/core/tests/require-auth-form.test.ts#4, 4b, 4c"
        status: pass
    human_judgment: false
  - id: D3
    description: "Releases: answering the last missing question, module off, no questions, only optional questions and archiving the last required question each release the member on the next request, with every answer still stored"
    requirement: PFORM-11
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-gate.test.ts#12-05 release"
        status: pass
    human_judgment: false
  - id: D4
    description: "Only the member role is gated: admin_tenant and support_tenant are never refused and get no profileForm key; another tenant's question never gates; cut, blocked and no-membership precedence hold"
    requirement: PFORM-11
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-gate.test.ts#12-05 who is gated, precedence"
        status: pass
    human_judgment: false
  - id: D5
    description: "GET /v1/me/bootstrap carries profileForm { pendingRequired, newOptional } from the same SQL rule and a live module read; absent for staff and module off; newOptional respects the dismissal instant"
    requirement: PFORM-12
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-gate.test.ts#12-05 tracer, release (notice counted from the dismissal instant)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Ten refused requests leave the membership, the profile and the Supabase session untouched (a refresh still works)"
    requirement: PFORM-11
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/profile-form-gate.test.ts#12-05 the gate only refuses"
        status: pass
    human_judgment: false
  - id: D7
    description: "The web half of PFORM-12 (the redirect and the notice that read the block) is not built in this plan"
    requirement: PFORM-12
    verification: []
    human_judgment: true
    rationale: "Plan 11 owns the web consumer; the API half is proven here, the screen is not"

duration: 17min
completed: 2026-10-29
status: complete
---

# Phase 12 Plan 05: The form gate and the bootstrap block Summary

**requireAuth now refuses a member with an unanswered required question as its very last check, from the count the membership lookup already returns, and the bootstrap tells the web whether the form is pending from the same SQL rule, proven on the live local stack.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-10-29T23:29:00Z
- **Completed:** 2026-10-29T23:46:00Z
- **Tasks:** 2 (1 tracer, 1 auto)
- **Files modified:** 12 (3 created, 9 modified)

## Accomplishments

- Tracer through every layer: the `_gate` SQL twin returns `profile_form_missing`, `Membership.profileFormMissing` carries it as a required number, `requireAuth` throws `PROFILE_FORM_PENDING` with `details.tenantName` only, and the error envelope reaches the client; one `execute` per lookup is asserted.
- The refusal order is pinned by a table-driven unit test: tenant suspended, blocked, invited, payment blocked, payment cut, and only then the form; an exact-path allow-list (`/v1/me/bootstrap`, `/v1/me/profile-form`, `/v1/me/profile-form/answers`, trailing slash tolerated) refuses `/answers/x`, `/profile-form-x` and `/counters`.
- `GET /v1/me/bootstrap` gains an additive optional `profileForm { pendingRequired, newOptional }`, absent (not null) for staff and when the module is off, built from `app.profile_form_missing_self()` and a live `tenant_modules` read inside the bootstrap's own transaction.
- 13 integration cases on the live stack: refusal on `/profile` and `/counters`, the bootstrap still 200, release by answering, by module off, by empty or optional-only form and by archiving, staff exempt, a second tenant's question inert, cut and blocked precedence, `TENANT_HOST_MISMATCH` unchanged, and ten refused requests leaving membership, profile and session untouched.

## Task Commits

1. **Task 1: [tracer] refusal in requireAuth from the lookup row** - `aea8a7aa` (feat)
2. **Task 2: bootstrap profileForm block and the gate on the live stack** - `88c31e5c` (feat)

**Plan metadata:** committed after this file (docs: complete plan).

## Files Created/Modified

- `packages/core/server/tenancy/membership.ts` - `profileFormMissing`, strict integer parse, calls to the `_gate` twins
- `packages/core/server/auth/require-auth.ts` - `PROFILE_FORM_ALLOWED_PATHS` and the last refusal
- `packages/contracts/src/errors.ts`, `packages/core/server/http/api-error.ts` - `PROFILE_FORM_PENDING` and its pt-BR line
- `packages/contracts/src/bootstrap.ts` - optional `profileForm`
- `packages/core/server/profile-form/member.ts` - `liveModuleOn`, `bootstrapBlock`
- `apps/api/src/routes/me.ts` - the bootstrap spreads the block when defined
- `packages/core/tests/require-auth-form.test.ts` - unit tests of the gate and the lookups
- `apps/api/tests/integration/profile-form-gate.test.ts`, `setup.ts` - the live-stack proof and its helpers
- `packages/core/tests/membership-pick.test.ts`, `require-auth-cut.test.ts` - fixtures gain `profileFormMissing: 0`

## Decisions Made

See `key-decisions`. The seed was not touched: `git diff --stat -- scripts/seed.ts` is empty and the module is enabled only inside `withProfileForm`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] An invited member on an onboarding path would be refused by the form**
- **Found during:** Task 1 (the unit test of the full order asserted that `/v1/me/invite` stays reachable for an invited membership with a pending form and got 403)
- **Issue:** the form check ran for any membership with `profileFormMissing > 0`, so an invited membership that passed the invited check (on `/v1/me/invite` or `/v1/me/accept-invite`) was refused by the form, whose allow-list does not contain those paths, and could never accept the invitation. The SQL rule does not look at the membership status.
- **Fix:** the form check applies only to `membership.status === 'active'`. The invited-path set and every other order step are unchanged.
- **Files modified:** `packages/core/server/auth/require-auth.ts`; covered by case 3 of `require-auth-form.test.ts`
- **Verification:** unit case 3 (invited reaches `/v1/me/invite`, other paths still `MEMBERSHIP_INVITED`)
- **Committed in:** `aea8a7aa`

**2. [Rule 2 - Missing critical] `Number(null)` and `Number('')` are 0**
- **Found during:** Task 1 (the precision truth: a broken value must be a 500, never "not pending")
- **Issue:** the plan's `Number(...)` plus `Number.isInteger` check would have read a null or blank count as 0 and therefore as "not pending".
- **Fix:** only a number or a non-blank string is converted; anything else becomes NaN and throws.
- **Files modified:** `packages/core/server/tenancy/membership.ts`
- **Verification:** unit cases 4b (negative, fractional, non-numeric, null, NaN, empty string all throw) and 4c (the string `'3'` parses)
- **Committed in:** `aea8a7aa`

**3. [Test isolation] Required questions leaked between integration cases**
- **Found during:** Task 2 (4 of 13 cases failed on the first run because a previous case's required question still gated the next case's fresh member)
- **Fix:** an `afterEach` removes every question carrying the file's title prefix. No production code changed.
- **Files modified:** `apps/api/tests/integration/profile-form-gate.test.ts`
- **Committed in:** `88c31e5c`

---

**Total deviations:** 2 auto-fixed (1 Rule 1, 1 Rule 2), 1 test-isolation fix.
**Impact on plan:** both fixes tighten correctness and match the stated truths; no scope change.

## Issues Encountered

- `pnpm turbo typecheck --filter=@rede-social/web` runs the web build as a dependency (about 380 MB of `.next` output); free space stayed at 5.1 GB, above the 3 GB stop line.
- A first complete gate run with a 580 s timeout produced no summary line; the rerun finished in 59 s with 41 of 41 tasks green.
- The routes `GET /v1/me/profile-form` and `POST /v1/me/profile-form/answers` do not exist yet (plans 06 and 07), so the allow-list is proven here by "the gate does not answer `PROFILE_FORM_PENDING`" (404 from the router), and the path variants are proven to be refused.

## Known Stubs

None.

## Threat Flags

None. T-12-11 (exact-path Set, unit cases for `/answers/x`, `/profile-form-x`, `/counters`), T-12-12 (the count rides the existing lookup, one `execute` per lookup asserted) and T-12-13 (the refusal is a thrown `ApiError` before `ctx` is set; ten refusals leave membership, profile and session identical) are mitigated and each has an automated test.

## User Setup Required

None - no external service configuration required. Nothing was pushed and no hosted project was touched.

## Next Phase Readiness

- Plan 06 can extend `packages/core/server/profile-form/member.ts` (the member's read of the form, `mode`) and mount `/v1/me/profile-form`; the gate already lets that path and `/v1/me/profile-form/answers` through.
- Plan 11 (web) can branch on the literal `PROFILE_FORM_PENDING` and read `bootstrap.profileForm`; the block is absent when there is nothing to answer.
- The release order matters for the fan-out: this API revision calls the `_gate` twins, so the tenant migrations must be applied before this revision serves (plan 18 release notes); the old `_gated` pair stays one release.
- Plan 12-01 (sketch 016, Igor's design-gate review) still has no SUMMARY and was not touched.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-29*

## Self-Check: PASSED

- Created files exist: `packages/core/server/profile-form/member.ts`, `packages/core/tests/require-auth-form.test.ts`, `apps/api/tests/integration/profile-form-gate.test.ts`.
- Commits `aea8a7aa` and `88c31e5c` exist; `git rev-list --count 567d0468..HEAD` is 2 before this commit.
- Acceptance re-run: `PROFILE_FORM_ALLOWED_PATHS` appears in `require-auth.ts` (2 or more); `PROFILE_FORM_PENDING` appears in `errors.ts` and `api-error.ts`; `membership_in_tenant_gate` and `memberships_of_user_gate` appear in `membership.ts`; `withProfileForm` is in `setup.ts`; `git diff --stat -- scripts/seed.ts` prints nothing; the staff bootstrap has no `profileForm` key (asserted).
- Plan verification: contracts vitest 342 passed; core unit tests 34 passed in the three named files; pgTAP `000-helpers.sql` and `220-profile-form.sql` 206 tests PASS (run before the integration file); `profile-form-gate.test.ts` 13 passed; `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4` 41 of 41 tasks successful.
