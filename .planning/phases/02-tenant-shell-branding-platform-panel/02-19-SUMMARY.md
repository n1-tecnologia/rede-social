---
phase: 02-tenant-shell-branding-platform-panel
plan: 19
subsystem: api
tags: [invites, platform, gotrue, contracts, gap-closure, drizzle, one-tenant-per-user]

# Dependency graph
requires:
  - phase: 02-05
    provides: createTenant single transaction, createPendingInvite, sendPendingInvites claim-before-send, the 23505 cause-chain mapping
  - phase: 02-10
    provides: resendInvite via generateLink + kernel transport, /aceitar-convite accept flow, invites.test.ts fixtures (throwawayInvited, Mailpit helpers)
  - phase: 02-17
    provides: ensureVerifiedSideEffects returning boolean + WR-01 clear of last_error on a successful re-run
provides:
  - INVITE_STATE_REASONS extended with email_in_use and user_in_other_tenant (contract consumed by 02-20)
  - identityConflict(tx, email, tenantId) — the ONE identity rule (public.users mirror ⋈ non-deleted memberships)
  - isOneTenantPerUserViolation(error) — 23505 on memberships_one_tenant_per_user_v1 only
  - refused invite state = status 'expired' + sent_at null (D-A), invite.refused log, 409 INVITE_STATE_INVALID { reason }
  - targeted onConflictDoNothing({ target: [tenantId, userId] }) at both membership insert sites
  - resendInvite recovery-link fallback for a confirmed-but-unaccepted invited admin (D-C)
  - createTenant 400 VALIDATION_FAILED { adminEmail: 'in_use' } inside the create transaction
  - tenant_domains.last_error = 'invite:<reason>' on a refused invite during verify; setPrimaryDomain never fails on an invite
affects: [02-20 panel refusals UI, platform panel Admins tab, Domínios card last_error rendering, V2 multi-tenant membership (identityConflict)]

# Actuals (#2632) — chars/4 over the 8 files actually changed (diff-only chars/4 = 11316)
actuals:
  tokens: 48830
  tasks: 3
  commits: 5
plan_head_before: 84dd8aab994012d14a9030f71a92d8bd6249f096

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Identity pre-check before any GoTrue admin call: read the public.users mirror + memberships in withAdminTx, never auth.admin (no get-by-email)"
    - "Refusal helper returns the ApiError after persisting the terminal state, so the update always precedes the throw"
    - "Targeted onConflictDoNothing({ target }) so only the intended unique index is tolerated; other 23505s are mapped by constraint name via the drizzle cause chain"
    - "Decide business state from OUR rows, not from an external service's error (GoTrue email_exists only means 'confirmed identity')"

key-files:
  created: []
  modified:
    - packages/contracts/src/invites.ts
    - packages/core/server/platform/invites.ts
    - packages/core/server/platform/tenants.ts
    - packages/core/server/platform/domains.ts
    - apps/api/src/routes/platform/tenants.ts
    - apps/api/tests/integration/invites.test.ts
    - apps/api/tests/integration/platform-tenants.test.ts
    - apps/api/tests/integration/platform-domains.test.ts

key-decisions:
  - "D-A shipped: a refused invite is status 'expired' with sent_at null (no new status, no schema change); sent_at IS NULL distinguishes a refusal from a lapsed link"
  - "D-B shipped: identityConflict is the single identity rule (identity + membership elsewhere -> user_in_other_tenant; identity without membership -> email_in_use; same-tenant membership or no identity -> null); createTenant passes the nil UUID so any membership counts"
  - "D-C shipped: the WR-04 fallback mints generateLink({ type: 'recovery' }) for the same redirectTo and reuses the invite template (type=recovery in the link); only for an 'invited' membership of this tenant"
  - "D-D shipped: ensureVerifiedSideEffects records invite:<reason> for a 409 INVITE_STATE_INVALID (else 'invite'); setPrimaryDomain wraps sendPendingInvites in try/catch and never fails the committed switch"
  - "GoTrue email_exists on the local stack: code 'email_exists', HTTP 422, 'A user with this email address has already been registered' for both inviteUserByEmail and generateLink invite; the send-path race guard mapping it to email_in_use is source-asserted, not integration-exercised (the pre-check refuses first)"
  - "isOneTenantPerUserViolation does NOT accept an empty constraint name (unlike the slug mapping): with the targeted conflict clause that index is the only 23505 the insert can raise"

patterns-established:
  - "Refusal-before-side-effect: any flow that can mail or re-token an identity pre-checks ownership from our tables first; the external service's duplicate answer stays only as a race guard"
  - "last_error cause suffix: '<step>:<reason>' when the failure carries a stable enum reason, plain '<step>' otherwise"

requirements-completed: [ROLE-03, TENANT-07]

coverage:
  - id: D1
    description: "Contract: INVITE_STATE_REASONS publishes exactly two new reasons (email_in_use, user_in_other_tenant); status enum unchanged"
    requirement: ROLE-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/invites.test.ts#contracts (02-10 Task 2) > ERROR_CODES carries MEMBERSHIP_INVITED + INVITE_STATE_INVALID"
        status: pass
      - kind: unit
        ref: "pnpm --filter @rede-social/contracts test (57 passed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "WR-02: an identity with a membership in another tenant is refused before any GoTrue call — 409 user_in_other_tenant, row expired + sent_at null, zero memberships, zero mails, idempotent on the second resend; 23505 on memberships_one_tenant_per_user_v1 maps to the same refusal"
    requirement: ROLE-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/invites.test.ts#refusals > R1"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/invites.test.ts#refusals > R3"
        status: pass
    human_judgment: false
  - id: D3
    description: "WR-03: a confirmed identity without membership is refused with 409 email_in_use (same terminal state, no mail); createTenant refuses such an adminEmail with 400 { adminEmail: 'in_use' } case-insensitively and leaves no tenant row; a host still verifies with last_error 'invite:email_in_use', cleared on the next verify"
    requirement: ROLE-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/invites.test.ts#refusals > R2"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/platform-tenants.test.ts#21. WR-03"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/platform-domains.test.ts#21. WR-03 / D-D"
        status: pass
    human_judgment: false
  - id: D4
    description: "WR-04: resend for a confirmed-but-unaccepted invited admin answers 200 sent with a recovery link that verifyOtp opens; invite stays sent and membership invited; an active membership answers 409 already_accepted with no mail"
    requirement: ROLE-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/invites.test.ts#refusals > WR-04 > R4"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/invites.test.ts#refusals > WR-04 > R5"
        status: pass
    human_judgment: false
  - id: D5
    description: "D-D: the primary switch answers 200 with the list even when the pending invite is refused inside it (TENANT-07 domain lifecycle stays independent of the invite outcome)"
    requirement: TENANT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-domains.test.ts#21. WR-03 / D-D (alias promotion with the invite re-pended)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The recovery link actually lands the admin on /aceitar-convite in the browser (the /auth/confirm route accepts type=recovery and honours next) — API side proves the token opens a session; the page flow is 02-20's e2e"
    requirement: ROLE-03
    verification: []
    human_judgment: true
    rationale: "Browser navigation through /auth/confirm?type=recovery&next=/aceitar-convite is not exercised by the API suites; 02-20 owns the e2e proof and the panel rendering"

# Metrics
duration: 15min
completed: 2026-09-17
status: complete
---

# Phase 02 Plan 19: Invite refusals by identity conflict, create-time adminEmail check, recovery-link resend fallback Summary

**An e-mail that already has an identity on the platform is now refused before any GoTrue call with a precise 409 reason (`email_in_use` / `user_in_other_tenant`) and a terminal `expired` + `sent_at null` row, `createTenant` rejects such an adminEmail as a 400 field error inside its transaction, domain verify records `last_error = 'invite:<reason>'` without failing the host, and `resendInvite` decides "accepted" from our membership row — minting a `recovery` link for a confirmed-but-unaccepted admin instead of a false `already_accepted`.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-09-17T13:42:37Z
- **Completed:** 2026-09-17T13:57:36Z
- **Tasks:** 3 (Tasks 1 and 2 TDD: RED → GREEN, no refactor commit needed)
- **Files modified:** 8

## Accomplishments

- WR-02 closed: both membership inserts use `onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] })`, so only the same-tenant/same-user replay is tolerated; a 23505 on `memberships_one_tenant_per_user_v1` (walked through drizzle's cause chain by `isOneTenantPerUserViolation`) is mapped to the `user_in_other_tenant` refusal — an invite can no longer be marked `sent` with no membership behind it.
- WR-03 closed: `identityConflict(tx, email, tenantId)` reads the `public.users` mirror joined to non-deleted `memberships` and runs (1) inside `createTenant`'s transaction before the `tenants` insert → `400 VALIDATION_FAILED { adminEmail: 'in_use' }`, (2) in `sendPendingInvites` after the claim, (3) in `resendInvite` before `generateLink`. GoTrue's `email_exists` on the first send maps to the same `email_in_use` refusal as a race guard. `ensureVerifiedSideEffects` records `invite:<reason>`, the host still verifies, and 02-17's clear removes the cause on the next verify once the row is no longer pending.
- WR-04 closed: when `generateLink({ type: 'invite' })` answers `email_exists`, `resendInvite` reads this tenant's membership for `tenant_invites.user_id`: `active` → `already_accepted`; `invited` → `generateLink({ type: 'recovery' })` for the same `redirectTo`, sent with the branded invite template (`type=recovery`), row `sent`; missing → `email_in_use` refusal; other → `not_invited`. R4 proves the recovery token opens a session for the invited address via `verifyOtp`.
- D-D: `setPrimaryDomain` wraps `sendPendingInvites` in try/catch (`platform.domains.invite_failed` with the reason) — the committed primary switch never fails because of an invite; pinned by the alias promotion in platform-domains case 21 with the invite re-pended in front of the switch.
- Contract + OpenAPI: `INVITE_STATE_REASONS` = `['already_accepted', 'no_verified_primary', 'not_invited', 'email_in_use', 'user_in_other_tenant']` (documented); POST 400 and resend 409 descriptions list every outcome.

## Task Commits

1. **Task 1 (RED): failing refusal cases R1-R3 + five-reason contract tuple** - `41eba32` (test)
2. **Task 1 (GREEN): identityConflict, refuseInvite, targeted conflict clause, 23505 mapping, email_exists guard** - `33448cb` (feat)
3. **Task 2 (RED): failing recovery-fallback case R4 + our-state guard R5** - `a660f97` (test)
4. **Task 2 (GREEN): resend decides from our state — recovery-link fallback** - `aeeb871` (feat)
5. **Task 3: create-time adminEmail check, last_error invite:<reason>, set-primary resilience, route descriptions, cross-suite proofs** - `b225fec` (feat)

**Plan metadata:** see the `docs(02-19)` commit that follows this summary.

## TDD Gate Compliance

| Task | RED commit | RED evidence | GREEN commit | REFACTOR |
|------|-----------|--------------|--------------|----------|
| 1 | `41eba32` | `RED_EVIDENCE_OK` — target R1 failed `expected 500 to be 409`; 4 failed / 13 passed | `33448cb` (17/17) | none needed |
| 2 | `a660f97` | `RED_EVIDENCE_OK` — target R4 failed `expected 409 to be 200`; 1 failed / 18 passed (R5 already passed via the old unconditional mapping and stays as the regression guard) | `aeeb871` (19/19) | none needed |

## Files Created/Modified

- `packages/contracts/src/invites.ts` - `INVITE_STATE_REASONS` gains `email_in_use` and `user_in_other_tenant` with docblock rows; `inviteStatusSchema` unchanged (D-A).
- `packages/core/server/platform/invites.ts` - `InviteRefusal`, `identityConflict`, `isOneTenantPerUserViolation`, module-private `refuseInvite`; `sendPendingInvites` steps (a') pre-check / (c) `email_exists` guard / (d) targeted conflict + 23505 mapping; `resendInvite` pre-check, `invitedUserRef` state read, our-state branch with the `recovery` fallback, `linkType` in `buildActionLink` and the `invite.resent` log.
- `packages/core/server/platform/tenants.ts` - `NIL_TENANT_ID`; `createTenant` lower-cases `adminEmail` once, calls `identityConflict` before the `tenants` insert, throws `400 VALIDATION_FAILED { adminEmail: 'in_use' }`, and rethrows `ApiError` untouched from the catch.
- `packages/core/server/platform/domains.ts` - `inviteRefusalReason(error)`; `ensureVerifiedSideEffects` records `invite:<reason>`; `setPrimaryDomain` try/catch around `sendPendingInvites`.
- `apps/api/src/routes/platform/tenants.ts` - POST 400 and resend 409 OpenAPI descriptions.
- `apps/api/tests/integration/invites.test.ts` - contract tuple; new describe `refusals — e-mail already on the platform (WR-02 / WR-03 / WR-04)` with R1, R2, R3 and the nested `WR-04` describe with R4, R5; helpers `insertVerifiedPrimary`, `membershipInLab`, `confirmedIdentity`, `membershipCount`, `inviteRow`, `resend`, `expectRefusedTwice`.
- `apps/api/tests/integration/platform-tenants.test.ts` - case 21 (API refusal twice, case-insensitive; zero tenant rows; service-level parity with a padded mixed-case address).
- `apps/api/tests/integration/platform-domains.test.ts` - case 21 (verified host with `lastError 'invite:email_in_use'`, refused invite, zero memberships, cleared on re-verify; alias attach + verify; invite re-pended; `POST …/primary` → 200 list with the alias primary; invite `expired` + `sentAt null` again, still zero memberships).

## Case list per suite (all green)

- `invites.test.ts` (19): cases 1-13 unchanged + R1 `user_in_other_tenant`, R2 `email_in_use`, R3 23505 mapping, R4 recovery fallback (200 sent, `type=recovery` mail, `verifyOtp` session, row `sent`, membership `invited`), R5 active membership → `already_accepted` with no mail.
- `platform-tenants.test.ts` (21): cases 1-20 unchanged + case 21 create-time refusal.
- `platform-domains.test.ts` (21): cases 1-20 (02-17) unchanged + case 21 `last_error` cause + set-primary resilience.
- Whole integration run: 16 files / 187 tests; `@rede-social/core` unit 119, `@rede-social/api` unit 15, `@rede-social/contracts` 57; lint + typecheck green on contracts/core/api.

## Decisions Made

- D-A/D-B/D-C/D-D shipped exactly as stated in the plan objective (see `key-decisions`).
- `identityConflict` reads every mirror row for the address (no `limit 1`) and reduces: a same-tenant membership wins, then any other membership, then identity-only. V1 has at most one membership per user so the result is identical to the planned `limit 1`, but the reduction stays correct if a second membership ever exists during the V2 migration.
- `createTenant` lower-cases and trims `adminEmail` once and hands the normalised value to both `identityConflict` and `createPendingInvite` (which already lower-cased); behaviour unchanged for the invite row.
- The `email_exists` shape observed on the local stack (probe with a throwaway confirmed user, deleted afterwards): `inviteUserByEmail` and `generateLink({ type: 'invite' })` both answer `code: 'email_exists'`, HTTP 422, message "A user with this email address has already been registered"; `generateLink({ type: 'recovery' })` succeeds with `properties.hashed_token`. `isConfirmedEmail` matches on the code, so the send-path race-guard branch (identity created between the pre-check and GoTrue) is source-asserted, not integration-exercised — the pre-check refuses before GoTrue is reached in R1/R2.
- The resend transport call keeps `meta.actionType: 'invite'` for the recovery fallback (the mail is still the invite template); only the link's `type` query parameter and the log line say `recovery`.

## Deviations from Plan

None - plan executed exactly as written. (Two docblock sentences were reworded so the acceptance greps count exactly one call site; no behaviour change.)

## Issues Encountered

- `gsd-tools check tdd-red-evidence` expects node:test-style `# tests/# pass/# fail` summary lines, which Vitest's `tap-flat` reporter does not emit; the RED records were built from the actual TAP `ok`/`not ok` lines with the derived summary appended (17/13/4 and 19/18/1), and both classified `RED_EVIDENCE_OK` on the intended target tests.
- The plugin hook suggesting Vercel-function skills on the API test file is a pattern false positive (the API is Hono on Cloud Run); ignored.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register: the recovery link surface (T-02-150) is gated exactly as specified (`user_id` set AND this tenant's non-deleted membership `invited`); the 409/400 reasons stay platform-lane only and never name the other tenant (T-02-152).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 02-20 can consume: `details.adminEmail === 'in_use'` on POST /v1/platform/tenants, `details.reason ∈ { email_in_use, user_in_other_tenant }` on resend, `last_error = 'invite:<reason>'` on a verified host, and the refused row shape `status 'expired' + sentAt null` for the "Convite recusado" pill.
- No schema change; `INVITE_STATE_REASONS` order is stable (`already_accepted, no_verified_primary, not_invited, email_in_use, user_in_other_tenant`).

## Self-Check: PASSED

- Files: all 8 modified paths exist on disk.
- Commits: `41eba32`, `33448cb`, `a660f97`, `aeeb871`, `b225fec` present in `git log`.
- `commits: 5` measured from `plan_head_before` `84dd8aa` (`git rev-list --count`).

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-17*
