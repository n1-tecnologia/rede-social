---
phase: 13-app-nativo-ios-e-android-por-tenant-white-label
plan: 13
subsystem: api
tags: [native-app, account-deletion, anonymisation, job, lgpd, apple-5.1.1, D-609, D-610, tracer, tdd]

requires:
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "13-07 app.account_deletion_request / _cancel / _notice_take / _due and app.account_anonymise (13-08 replaced the last one); 13-10 the me.ts bootstrap additions; 13-03 the bootstrap pendingDeletion contract"
provides:
  - "POST /v1/me/account-deletion (password re-verified against the tenant's own Auth, SQL request, global sign-out, { dueAt }) and GET /v1/me/account-deletion ({ isLastAdmin })"
  - "Error codes LAST_ADMIN (409), WRONG_PASSWORD (403) and RATE_LIMITED (429)"
  - "requireAuth cancel path: a fresh sign-in inside the 14 days cancels the request; the bootstrap carries pendingDeletion once"
  - "accounts.anonymise-due: hourly self-pacing tenant-scope job (read address, completion e-mail, Auth soft delete, app.account_anonymise, identity-mirror scrub)"
  - "account-deleted mail template and sendAccountDeletedMail; in-process attempt limiter (5 per 15 minutes)"
affects: [13-19, 13-22]

plan_head_before: 8c75aafea8f2aba386c848f496728e38de802ba1
actuals:
  tokens: 25500
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "job logic as a pure run over injected dependencies (listDue, getAuthUser, sendMail, ...), production wiring in productionDeps(projectId), an anonymiseDueOnce(projectId, overrides) seam for the integration suite"
    - "password re-verification with a raw Auth password grant and the project's own key, result discarded; the SQL deactivation is the commit point and the global sign-out is best effort after it"
    - "set-based, resumable mirror scrub: a user whose memberships are ALL anonymised, so a crash between the Auth delete and the scrub heals on the next run"

key-files:
  created:
    - packages/core/server/accounts/deletion.ts
    - packages/core/server/accounts/rate-limit.ts
    - packages/core/server/accounts/anonymise-job.ts
    - packages/core/server/accounts/index.ts
    - packages/core/server/mail/templates/account-deleted.ts
    - packages/core/tests/anonymise-job.test.ts
    - packages/core/tests/account-deletion-request.test.ts
    - apps/api/tests/integration/account-deletion.test.ts
    - apps/api/tests/admin-lane-inventory/accounts.ts
  modified:
    - packages/core/server/auth/require-auth.ts
    - packages/core/server/mail/index.ts
    - packages/core/server/http/api-error.ts
    - packages/contracts/src/errors.ts
    - apps/api/src/routes/me.ts
    - apps/api/src/worker.ts
    - apps/api/tests/isolation-inventory.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/admin-lane-inventory/index.ts
    - biome.json

key-decisions:
  - "Identity mirror (public.users e-mail and name, residual item 1 of 13-07): scrubbed to removed-<user id>@removed.invalid / 'Membro removido' once EVERY membership of the user is anonymised, in one set-based pass at the end of each run (so it is resumable). FOR IGOR'S REVIEW."
  - "The Auth account is soft-deleted only when the person holds no OTHER non-anonymised membership; production tenants share project 0 today, and deleting the identity of a person who belongs to two communities would sign them out of the second. The rows of the deleted membership are anonymised either way; the address is reusable only after the last membership goes. FOR IGOR'S REVIEW."
  - "chat_messages.body (the member's messages to the support team) is kept as content under 'Membro removido'; no per-person scrub was agreed (13-07 residual item 2). FOR IGOR'S REVIEW."
  - "The avatar storage object (13-07 residual item 3) needs no new code: account_anonymise marks the avatar media_assets row deleted, and the existing kernel.media-sweep-orphans job purges `deleted` rows older than one hour together with their Storage objects. Not exercised in this plan's tests."
  - "The cancel path lives on the tenant-host branch of requireAuth only; on a generic host (localhost, Preview, platform host) no tenant is known, so no cancel is attempted and today's refusal is unchanged."
  - "The completion e-mail is at-least-once (A-13-04): sent before the Auth soft delete, narrowed by an idempotency key `account-deleted:<membership id>`, skipped when the Auth account is already gone."
  - "The job re-arms in its own transaction after the batch and before it raises, not in the work's transaction: the work calls Auth and the mail provider and no transaction is held across those calls."

patterns-established:
  - "Tenant-lane routes cannot be exempted in the isolation inventory (the unit guard allows only health, openapi, public, hooks, webhooks, platform): a new `me` route needs an it() in isolation.test.ts"
  - "A new withAdminTx site needs rows in apps/api/tests/admin-lane-inventory (new area file `accounts.ts`)"

requirements-completed: [NATIVE-19, NATIVE-21]

coverage:
  - id: D1
    description: "Tracer: request with the password (wrong is 403 and changes nothing), deactivation at once, old token refused, fresh sign-in cancels, pendingDeletion once, pre-request token never cancels, after the deadline the fresh sign-in is refused, again does not extend"
    requirement: "NATIVE-19"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/account-deletion.test.ts (tracer describe, 5 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Body edges (missing, empty, whitespace, 257 characters, extra key, non-string, not JSON) are 400 with nothing changed; 256 characters reaches the check"
    requirement: "NATIVE-19"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/account-deletion.test.ts (the body)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Rate limit 5 per 15 minutes per member and per address (429, nothing changes, other members unaffected) and the limiter's own window, bound and all-or-nothing rules"
    requirement: "NATIVE-19"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/account-deletion.test.ts (rate limit, 2 tests)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/account-deletion-request.test.ts (attempt limiter, 4 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Administrators: two admins either may delete and the second gets LAST_ADMIN; one admin plus one support is refused while support and member are never refused; isLastAdmin returns false with no query for non-admins"
    requirement: "NATIVE-19"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/account-deletion.test.ts (administrators, 2 tests)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/account-deletion-request.test.ts (isLastAdmin, request order, AD001, sign-out failure, log hygiene)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The job end to end on the local stack: completion e-mail in Mailpit with tenant name and date only, Auth user soft-deleted and old password refused, address reusable for a NEW member, post and comment still read as removed member, mirror scrubbed, devices gone, tenant B byte-identical with a positive control, a second run changes nothing"
    requirement: "NATIVE-21"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/account-deletion.test.ts (accounts.anonymise-due, 2 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Job unit rules: step order, mail failure raises after the batch and keeps the member due, resume after a failure past the soft delete, kept identity, empty list re-arms, already-deleted Auth skips the mail; equal deadlines order by membership id on the real database"
    requirement: "NATIVE-21"
    verification:
      - kind: unit
        ref: "packages/core/tests/anonymise-job.test.ts (7 job tests, 5 template tests)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/account-deletion.test.ts (ordering with equal deadlines)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Template safety: accents and an ampersand and markup in the tenant name render as UTF-8 text, no header injection through the name, the mail carries tenant name, date and one sentence only; sentinel password, address and token never reach a log line"
    requirement: "NATIVE-21"
    verification:
      - kind: unit
        ref: "packages/core/tests/anonymise-job.test.ts (template)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/account-deletion.test.ts (logs, T-13-31)"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-11-05
status: complete
---

# Phase 13 Plan 13: Account deletion flow (route, cancel by sign-in, anonymisation job) Summary

**"Excluir minha conta" end to end on the API and the worker: a password-checked request that deactivates the member at once and signs them out everywhere, a fresh sign-in inside 14 days that cancels it (once, with a one-time notice), and an hourly job that e-mails the confirmation, soft-deletes the Auth account, anonymises the rows in place and scrubs the identity mirror.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-11-05T16:10:00Z
- **Completed:** 2026-11-05T16:32:00Z
- **Tasks:** 3 (tracer, TDD job, gate)
- **Files modified:** 19 (9 created, 10 modified)

## Accomplishments

- `POST /v1/me/account-deletion`: strict `{ password }` body, rate limited, password verified with an Auth password grant of the tenant's own project BEFORE any write, `app.account_deletion_request()` in the tenant transaction (`AD001` becomes 409 `LAST_ADMIN`), global sign-out with the caller's own token, answer `{ dueAt }`, `Cache-Control: no-store`. It acts on `ctx.userId` only. `GET` answers `{ isLastAdmin }` (false with no query unless `admin_tenant`).
- `requireAuth`: on a tenant host, a lookup with no live membership asks `app.account_deletion_cancel(tenant, user, token iat)` once; only a token issued after the request and before the deadline cancels; on success the lookup is repeated. Any failure of the call keeps today's refusal exactly. The bootstrap reads `app.account_deletion_notice_take()` in its own transaction, so `pendingDeletion` appears once.
- `accounts.anonymise-due`: registered in the worker and armed per project at start under a boot singleton. Per due member, in the SQL order (deadline then id): read the address from Auth, send the completion e-mail, soft-delete the Auth user, `app.account_anonymise`. A failure at any step is recorded by shape only and re-raised after the batch (the member stays due); the re-arm happens first.
- The completion e-mail carries the tenant name, the date in the tenant's time zone and one sentence; it was observed in Mailpit.

## Task Commits

1. **Task 1: [tracer] request, deactivate, cancel by sign-in, notice once** - `c2d94673` (feat)
2. **Task 2 RED: failing proofs of the job order, failures and template** - `e1087ab4` (test)
3. **Task 2 GREEN: the anonymisation job** - `79503847` (feat)
4. **Task 3: [GATE] rate limit, roles, ordering and log hygiene** - `7ba9f4cb` (test)

**Plan metadata:** the docs commit that carries this summary.

## TDD Gate Compliance

- RED `e1087ab4` precedes GREEN `79503847` (`test(13-13)` then `feat(13-13)`). No refactor commit.
- RED evidence: `pnpm --filter @rede-social/core exec vitest run tests/anonymise-job.test.ts` exited 1 with 12 tests, 8 failed on their assertions (for example `expected [] to deeply equal [ 'getAuthUser:u-a', … ]`, `expected +0 to be 1`) and 4 passed (the template tests, since the template file already existed). The REAL Vitest JSON report was converted to TAP by a throwaway script kept in the scratchpad, outside the repo, and `gsd check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`). The RED commit holds a skeleton `runAnonymiseDue` that returns an empty result, so the failures are behavioural, not import errors.
- GREEN: the same file passed 12 of 12 on the first run. The integration scenarios for the job (Tests 4 and 5 of the plan) were written after the implementation, in the GREEN commit, and passed on their first run.

## Decisions for Igor's review (the residual inventory of 13-07)

| Residual item | Decision here |
|---|---|
| 1. `public.users.email` and `name` | Scrubbed to `removed-<user id>@removed.invalid` and `Membro removido` when every membership of the user is anonymised. It is a set-based pass after the members of each run, so it is resumable. GoTrue's soft delete does NOT touch it (the mirror trigger is insert-only), and a stale address there would have been matched by the by-address lookups that read `public.users`. |
| 2. `chat_messages.body` | Kept, shown under "Membro removido". Not scrubbed per person (no agreement). |
| 3. Avatar storage object | No new code: `account_anonymise` marks the avatar `media_assets` row `deleted`, and the existing media sweeper purges deleted rows older than one hour with their Storage objects. Not exercised in this plan. |
| 4. `email_allowlist.email` | Untouched (platform list, not tenant data). |
| Shared identity | The Auth account is soft-deleted only when the person has no other non-anonymised membership. Production tenants share project 0 today, so a person in two communities who deletes one keeps the other. Consequence: the address is reusable (and the "new member" sign-up works) only after the LAST membership is gone. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] There is no request limiter in the repository**
- **Found during:** Task 1
- **Issue:** The plan says "the repository's existing limiter"; the only `limiter.ts` paces outbound Management API calls and cannot answer 429.
- **Fix:** `packages/core/server/accounts/rate-limit.ts`, a small in-process sliding-window limiter (5 attempts, 15 minutes, per member and per address from `X-Client-IP`, bounded key map, injected clock), all-or-nothing consume. It is per process, so the ceiling is 5 times the instance count on Cloud Run; Auth's own password-grant limit sits behind it.
- **Files modified:** `packages/core/server/accounts/rate-limit.ts`, `apps/api/src/routes/me.ts`
- **Commit:** `c2d94673`

**2. [Rule 2 - Missing critical] A third error code, `RATE_LIMITED`**
- **Found during:** Task 1
- **Issue:** The plan names `LAST_ADMIN` and `WRONG_PASSWORD` only, but the 429 needs a stable code (a bare HTTPException answers `HTTP_ERROR`).
- **Fix:** `RATE_LIMITED` appended to `ERROR_CODES`, with its message in `api-error.ts` (a `Record<ErrorCode, string>`, so the file had to change although it is not on the plan's list).
- **Files modified:** `packages/contracts/src/errors.ts`, `packages/core/server/http/api-error.ts`
- **Commit:** `c2d94673`

**3. [Rule 3 - Blocking] No Auth password helper exists in the server**
- **Found during:** Task 1
- **Issue:** The plan says "the shipped server helper"; only the web app signs in. Project 0 keeps no publishable key in the registry.
- **Fix:** a raw `POST /auth/v1/token?grant_type=password` with the project's publishable key (the service key for the environment project), result discarded; 400/401/422 mean wrong password, anything else is 503 `TENANT_UNAVAILABLE`. A memoised service-key client is NOT used for it (a sign-in would put a user session on a shared client).
- **Files modified:** `packages/core/server/accounts/deletion.ts`
- **Commit:** `c2d94673`

**4. [Rule 3 - Blocking] The inventories reject the new surface**
- **Found during:** Tasks 1 and 3
- **Issue:** the isolation inventory forbids exempting a tenant-lane route, so it needs a cross-tenant `it()`; the admin-lane inventory lists every `withAdminTx` site.
- **Fix:** an `it('phase 13 sweep: account deletion …')` in `isolation.test.ts`, two entries in `isolation-inventory.ts`, and a new `accounts.ts` area with 7 rows in `apps/api/tests/admin-lane-inventory/`.
- **Commits:** `c2d94673`, `7ba9f4cb`

**5. [Plan wording] Signature and re-arm transaction**
- `requestAccountDeletion(ctx, { password, email, accessToken }, deps, logger)` takes the address and the caller's token inside the input object (they come from the verified token, not the body).
- The job re-arms in its own transaction after the batch instead of "in the same transaction as the work" (the work calls Auth and the mail provider; no transaction is held across them). The cadence still survives a failing run because the re-arm precedes the raise.

**6. [Verify command] No `pnpm db:reset`**
- The project rule allows at most one reset and only when needed; the local database already carried every migration of 13-07 and 13-08, so the pgTAP and integration runs went against it as it was (whole `pnpm supabase test db`: 57 files, 3548 tests, PASS).

**Total deviations:** 6 (3 blocking fixes, 1 missing-critical addition, 2 plan-wording adjustments)
**Impact on plan:** none on behaviour; every plan truth is covered.

## Issues Encountered

- `iat` is whole seconds, so a sign-in in the SAME second as the request fails the `iat > deletion_requested_at` rule. Real people cannot sign in that fast; the integration tests wait 1.3 s before the fresh sign-in. Plan 19 should not retry-cancel in a tight loop.
- A malformed JSON body to the new route logs one `HTTP_ERROR` line at level error from the shared validator (pre-existing behaviour of the Hono validator; it carries no body).
- `GET /v1/openapi.json` still returns 500 (pre-existing `notificationQuerySchema.limit` `.catch()`); not touched.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-13-29 (stolen session erases an account) is mitigated and proven: wrong password 403, 429 per member and per address, only `ctx.userId` is acted on (a foreign tenant host is refused before the password is read, `isolation.test.ts` case), the completion e-mail and the 14-day window remain. T-13-30 (old token cancels) is proven by the pre-request-token test and the SQL `iat` rule. T-13-31 (disclosure in logs and mail) is proven by the sentinel-password log capture, the unit check that no log call receives the password, address or token, and the template tests (escaping, no header injection, one sentence).

## User Setup Required

None. Deploy order for hosted environments stays migration, API, worker; the new queue `accounts.anonymise-due` is created by the worker at start. Nothing was pushed or applied to a hosted project, and the only mail sent was to the local Mailpit.

## Next Phase Readiness

- Plan 19 (screens): `POST /v1/me/account-deletion` answers `{ dueAt }` (ISO); `GET` answers `{ isLastAdmin }`; the error codes are `WRONG_PASSWORD` (403), `LAST_ADMIN` (409), `RATE_LIMITED` (429), `VALIDATION_FAILED` (400). After the request the very next call with the old token answers `TENANT_HOST_MISMATCH`: the app should sign out locally on a 200. A sign-in inside the window needs no call: the first authenticated request cancels, and `bootstrap.pendingDeletion` is `{ until }` once (the cancelled deadline, ISO) for the "Exclusão cancelada" toast. NATIVE-20 stays Pending until plan 19.
- Cancel works on a tenant host only (the native app uses its tenant's host).
- The limiter is in memory per instance; a shared store would be a V2 item if the instance count grows.

## Self-Check: PASSED

- Files exist (checked with `ls`): `deletion.ts`, `rate-limit.ts`, `anonymise-job.ts`, `index.ts` in `packages/core/server/accounts`, `account-deleted.ts`, both core test files, `account-deletion.test.ts`, `accounts.ts` in the admin-lane inventory.
- Commits found: `c2d94673`, `e1087ab4`, `79503847`, `7ba9f4cb`; `git rev-list --count 8c75aafe..HEAD` is 4.
- Acceptance: `git diff` of `require-auth.ts` adds the call inside the no-membership branch and removes no gate; `grep -n "logger.*password" apps/api/src/routes/me.ts` prints nothing; `LAST_ADMIN` and `WRONG_PASSWORD` are in `errors.ts`; `accounts.anonymise-due` appears 5 times in `anonymise-job.ts`; `deleteUser(userId, true)` is the soft delete; `grep -rn "delete from public\.\(feed\|post\)" packages/core/server/accounts` prints 0; the 429 case exists in the integration test.
- Gates run: core vitest 101 files / 1487 tests; api unit 11 files / 131 tests; `pnpm boundaries` and `pnpm guard:lanes` clean; typecheck core, api, contracts via turbo and web via `tsc --noEmit`; whole pgTAP PASS; integration `account-deletion` 14, `auth-middleware` and `bootstrap` unchanged (57 tests with the three files), isolation case, `jobs` and `jobs-routing`.

---
*Phase: 13-app-nativo-ios-e-android-por-tenant-white-label*
*Completed: 2026-11-05*
