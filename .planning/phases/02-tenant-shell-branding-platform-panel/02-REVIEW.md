---
phase: 02-tenant-shell-branding-platform-panel
reviewed: 2026-09-17T14:47:57Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - apps/api/src/routes/me.ts
  - apps/api/src/routes/platform/tenants.ts
  - apps/api/tests/integration/invites.test.ts
  - apps/api/tests/integration/platform-domains.test.ts
  - apps/api/tests/integration/platform-tenants.test.ts
  - apps/web/app/(platform)/plataforma/actions.ts
  - apps/web/app/(platform)/plataforma/tenants/[id]/admins/page.tsx
  - apps/web/components/platform/AdminsCard.tsx
  - apps/web/components/platform/LogoUpload.test.ts
  - apps/web/components/platform/LogoUpload.tsx
  - apps/web/components/platform/ResendInviteButton.tsx
  - apps/web/e2e/invite.spec.ts
  - apps/web/e2e/platform-tenants.spec.ts
  - apps/web/lib/tenant-host.test.ts
  - apps/web/lib/tenant-host.ts
  - apps/web/messages/pt-BR/platform.json
  - apps/web/package.json
  - packages/contracts/src/invites.ts
  - packages/core/server/domains/fake.ts
  - packages/core/server/platform/domains.ts
  - packages/core/server/platform/invites.ts
  - packages/core/server/platform/tenants.ts
  - packages/core/server/tenancy/membership-scope.ts
  - packages/core/tests/domains-fake.test.ts
  - packages/core/tests/membership-scope.test.ts
  - pnpm-lock.yaml
findings:
  critical: 0
  warning: 1
  info: 8
  total: 9
status: issues_found
---

# Phase 02: Code Review Report (incremental #3 — plans 02-17..02-20)

**Reviewed:** 2026-09-17T14:47:57Z
**Depth:** standard
**Files Reviewed:** 26 (diff range `35b5780..HEAD`; the previous REVIEW.md at that commit is superseded by this one)
**Status:** issues_found

## Summary

This pass judges whether the eight findings of the previous review (CR-01, WR-01..WR-07) are actually closed by plans 02-17..02-20, and reads the new code adversarially for regressions. Verification performed: full read of the diff per file, `biome check` on every changed source file (clean), `tsc --noEmit` on `packages/core` and `apps/web` (clean), the new unit tests in `apps/web` (7 pass, ~2.2 s) and `packages/core` (9 pass). Integration/e2e suites were read, not run (they need the local Supabase stack).

**Prior findings — closure verdict**

| Prior | Verdict | Evidence |
|---|---|---|
| CR-01 poller dies after a provider error | **Closed** | `checkDomain` error branch (`domains.ts:472-514`) now evaluates `verifyDeadlineAt`, marks `expired` past the deadline, and re-arms `enqueueVerify` in the same transaction otherwise; `where verified_at is null` guards the racing winner. Fake adapter seam `provider-fails-once` + integration cases 17-19 exercise pending→re-arm, re-check→verified, and error-past-deadline→expired→restart. |
| WR-01 `last_error` never cleared on a verified host | **Closed** | `ensureVerifiedSideEffects` returns `ok`; both callers run `clearLastErrorIfSettled` on success (`domains.ts:351-362, 461-463, 538-541`); case 20 covers the clear and the no-op. |
| WR-02 `onConflictDoNothing` hid the one-tenant-per-user conflict | **Closed** | Both membership inserts target `[tenantId, userId]` (`invites.ts:284, 624`); a 23505 on `one_tenant_per_user` is mapped by `isOneTenantPerUserViolation` to a `user_in_other_tenant` refusal; the pre-check `identityConflict` refuses before GoTrue in the common case (R1). |
| WR-03 GoTrue `email_exists` → opaque 500 / permanent `invite` | **Closed** | `identityConflict` at create time (400 `{ adminEmail: 'in_use' }`, `tenants.ts:202-205`, case 21) and at send/resend (409 with reason); domain `last_error` now `invite:<reason>` and the panel names the cause. |
| WR-04 false `already_accepted` after link exchange | **Closed** | Acceptance decided from our membership row; `invited` → recovery-type link for the same `redirectTo` (`invites.ts:507-545`), R4 opens a session from it, R5 covers the `active` case. |
| WR-05 bootstrap membership read scoped by user only | **Closed** | `membershipOfRecord(ctx)` (`membership-scope.ts`) used in `me.ts:100`; unit test asserts the rendered predicate. |
| WR-06 host lookup without timeout | **Closed** | `AbortSignal.timeout(2_000)` on the by-host fetch; timeout is cached for `TTL_ERROR_MS` (test 1-2). |
| WR-07 upload hook stuck in `progress` on a rejected action | **Closed** | `try/catch` around `onFile` with `fail()` in the catch (`LogoUpload.tsx:64-117`); hook tests 1, 2, 3a, 3b. |

**New issues.** No regression of tenant isolation, no injection, no secret exposure. The one warning is a recoverability regression introduced by the new identity pre-check: an identity that *our own* `inviteUserByEmail`/`generateLink` created is indistinguishable, on the `public.users` mirror, from a foreign orphan identity — so a transient failure in the membership transaction that follows a successful GoTrue call turns the invite into a permanent `email_in_use` refusal (WR-01 below). Previously the resend would have recovered that state. Everything else is Info: misleading reasons in edge cases, a docblock/ordering mismatch, test coupling, and UX rough edges.

## Warnings

### WR-01: A failure after the GoTrue call turns our own invited identity into a permanent `email_in_use` refusal

**File:** `packages/core/server/platform/invites.ts:77-91, 278-299, 616-640`
**Severity:** WARNING
**Issue:** `identityConflict` classifies "identity in the mirror with no non-deleted membership anywhere" as `email_in_use` — with no way to tell a foreign orphan from the identity that **our own** `inviteUserByEmail` (line 241) or `generateLink` (line 502/540) just created. Both senders create the GoTrue identity first (the `on_auth_user_created` trigger mirrors it inside GoTrue's transaction) and only afterwards, in a second `withAdminTx`, insert the membership and stamp `tenant_invites.user_id`. If that second transaction fails for any reason other than a 23505 (pooler hiccup, `waitForMirroredUser` exhausting its ~300 ms, a DB error), the code path is `throw error` (lines 298, 639): the invite row stays `sent` with `user_id = null` and no membership. The mail has already gone out. From then on:

- every "Reenviar convite" enters the `sent`/`expired` branch, `identityConflict` sees the identity with no membership → `refuseInvite(…, 'email_in_use')` → row `expired`/`sent_at null`, panel shows "Convite recusado — o e-mail já está em uso" (which is false: the only account is the one we created);
- the admin who clicks the delivered link is confirmed by `/auth/confirm`, lands on `/aceitar-convite` with no membership, and cannot accept;
- there is no self-service recovery: the super_admin cannot re-send, and deleting the GoTrue user by hand is the only way out.

Before 02-19 the same failure was recoverable (`generateLink` + `onConflictDoNothing` on resend). The window is narrow, but the outcome is a silent, permanent dead end with a misleading diagnostic, and the refused row is terminal by design (D-A).

**Fix:** Let the pre-check recognise the identity the invite itself owns, and make the back-reference survive a failed membership insert:

```ts
// identityConflict: an identity the invite already points at is ours, whatever the mirror says.
export async function identityConflict(tx, email, tenantId, ownUserId: string | null = null) {
  const rows = await tx.select(/* … */);
  if (rows.length === 0) return null;
  if (ownUserId && rows.some((r) => r.userId === ownUserId)) return null;
  if (rows.some((r) => r.membershipTenantId === tenantId)) return null;
  /* … */
}

// sendPendingInvites (d): stamp user_id in its own statement BEFORE the membership insert,
// so a later failure leaves a row that the next send/resend can adopt.
await withAdminTx((tx) =>
  tx.update(tenantInvites).set({ userId: invitedUserId }).where(eq(tenantInvites.id, invite.id)),
);
try {
  await withAdminTx(async (tx) => {
    await waitForMirroredUser(tx, invitedUserId);
    await tx.insert(memberships).values({ /* … */ }).onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] });
  });
} catch (error) {
  if (isOneTenantPerUserViolation(error)) { /* refuse user_in_other_tenant */ }
  // Not a refusal: revert the claim so the next send retries (the identity is ours now).
  await withAdminTx((tx) => tx.update(tenantInvites).set({ status: 'pending', sentAt: null }).where(eq(tenantInvites.id, invite.id)));
  throw error;
}
```

Then pass `invite.userId` (select it alongside `id`/`email` in the pending query, and `invitedUserRef` in `resendInvite`) into every `identityConflict` call. Add an integration case that makes the membership transaction fail once after a successful `inviteUserByEmail` (e.g. temporarily revoke insert on `memberships` for `api_user`, or stub `waitForMirroredUser`) and asserts the following resend answers 200 `sent` with a membership, not 409.

## Info

### IN-01: An existing member of the SAME tenant is refused with the wrong reason

**File:** `packages/core/server/platform/invites.ts:88, 246-253, 530-533`
**Issue:** `identityConflict` returns `null` for any non-deleted membership in this tenant, regardless of role/status (the comment says "our own invited admin", but an `active` `member` matches too). The send then reaches GoTrue, which answers `email_exists` for the confirmed user, and the race guard refuses with `email_in_use` — the panel tells the super_admin the address "already has an account on the platform" when it is this very tenant's member. `resendInvite` ends the same way (`invitedUserRef` is null → `membership === null` → `email_in_use`). Rare in V1 (the first admin usually precedes members) but the diagnostic is wrong and the refused row is terminal.
**Fix:** Have `identityConflict` return a distinct reason (e.g. `member_of_this_tenant`) when the same-tenant membership is not `admin_tenant`/`invited`, or let the send promote that membership instead of inviting; at minimum add the reason to `INVITE_STATE_REASONS` and the catalog.

### IN-02: The identity pre-check runs in a separate transaction after the claim

**File:** `packages/core/server/platform/invites.ts:220-238`
**Issue:** The claim (`pending → sent`) commits in one `withAdminTx`, then `identityConflict` runs in another. A thrown DB error from the second (not a refusal) propagates with the row already `sent`/`sent_at` set and nothing sent: the Admins tab shows "Convite enviado em {date}" for a mail that never left. Recoverable through "Reenviar convite" (the `sent` branch re-mints), but the pill lies until then.
**Fix:** Run `identityConflict` inside the claim transaction and, on refusal, write the refused state there (`status: 'expired', sentAt: null`) instead of a second update — one round-trip fewer and no window with a false `sent`.

### IN-03: A lapsed recovery-type resend link lands on the password-recovery screen, not `/convite-expirado`

**File:** `packages/core/server/platform/invites.ts:537-544` (consumer: `apps/web/app/auth/confirm/route.ts:64-67`)
**Issue:** The WR-04 fallback sends `type=recovery` in the invite mail. `/auth/confirm` routes a failed exchange to `/convite-expirado` only for `type === 'invite'`; a recovery link that expired or was superseded falls through to the generic "ask for a fresh link" (recovery) screen. Since the identity is confirmed, recovery actually works there, so this is a UX inconsistency rather than a dead end — but the invite e-mail template and the panel copy still speak of an invite.
**Fix:** Carry the intent in `next` (already `/aceitar-convite`) and branch on it in `/auth/confirm`'s failure path (`if (type === 'invite' || safeNext === '/aceitar-convite') redirect('/convite-expirado')`), or document that a lapsed recovery-type invite lands on password recovery.

### IN-04: `no_verified_primary` on a non-pending resend surfaces as the generic "Tente novamente"

**File:** `apps/web/app/(platform)/plataforma/tenants/[id]/admins/page.tsx:35, 48-51`; `apps/web/components/platform/ResendInviteButton.tsx:47-50`
**Issue:** `canResend` is `true` for every non-`pending` row, so a `sent`/`expired`/`refused` invite whose tenant lost its verified primary (host removed, expired) offers the button; the API answers 409 `{ reason: 'no_verified_primary' }` and the new `reasonCopy` maps only the two refusal reasons, so the toast says "Não foi possível reenviar o convite. Tente novamente." — advice that cannot work.
**Fix:** Add `no_verified_primary: t('admins.resendHelper')` to `labels.reasons` (the copy already exists) and widen `reasonCopy`'s allow-list; or compute `canResend` from `primaryVerifiedHost(detail) !== null` for every status.

### IN-05: `detail.invites[0]` is the oldest row, the docblock says "the newest"

**File:** `apps/web/app/(platform)/plataforma/tenants/[id]/admins/page.tsx:8, 25`; `packages/core/server/platform/tenants.ts:279`
**Issue:** The detail service orders invites `asc(createdAt)`; the page reads `[0]` and documents it as the newest. Harmless in V1 (one invite per tenant) but the new `refused` derivation now hangs off that element, and the first V2 re-invite makes the page show the stale row.
**Fix:** Read `detail.invites.at(-1)` (or order `desc` in the service and fix the docblock).

### IN-06: `onCompleted` and the success toast run inside the upload `try`

**File:** `apps/web/components/platform/LogoUpload.tsx:107-117`
**Issue:** The WR-07 `try` wraps `onCompleted(completed.view)` and `toast.show(...)`. If the parent's callback throws (a state update on an unmounted form, a bug in `BrandingForm`), the catch reports `platform.branding.upload_failed` and shows `errors.generic` for an upload the API has already recorded — the zone says "failed", the object is live.
**Fix:** Capture the result inside the `try` and call `onCompleted`/`toast.show` after it:
```ts
let done: BrandingView | null = null;
try { /* … */ done = completed.view; } catch (error) { /* fail(...) */ }
if (done) { onCompleted(done); toast.show({ tone: 'success', message: t('toasts.saved') }); }
```

### IN-07: `tenant-host.test.ts` case 2 depends on case 1's cache side effect and on 2 s of wall time

**File:** `apps/web/lib/tenant-host.test.ts:61-90`
**Issue:** Case 2 asserts "no second fetch" using the module-level cache populated by case 1 (same `slowHost`, `fetchMock` reset between cases). Run in isolation (`-t`, `.only`, or a future shuffle), case 2 performs its own 2 s hanging fetch and fails on `toHaveBeenCalledTimes(0)`. Case 1 also spends a real 2 s (`AbortSignal.timeout` cannot be driven by fake timers), which is fine but worth a comment.
**Fix:** Populate the cache inside case 2 itself (call `resolveHostTenant(slowHost)` once with a mocked immediate failure, then assert the cached answer), or merge cases 1 and 2.

### IN-08: The 23505 race guard is covered only by a synthetic unit case

**File:** `apps/api/tests/integration/invites.test.ts:R3`, `packages/core/server/platform/invites.ts:100-114`
**Issue:** R1 refuses at the pre-check, so no integration case ever drives a real `memberships_one_tenant_per_user_v1` violation through drizzle + postgres.js into `isOneTenantPerUserViolation`. The helper is strict on purpose (it rejects an empty `constraint_name`), so a property-name mismatch in the driver's error shape would silently fall through to `throw error` — re-creating the original WR-02 symptom (row `sent`, no membership) in the race path.
**Fix:** Add a case that inserts the foreign membership *after* `createUser` but *before* the resend, with the pre-check bypassed (e.g. run `sendPendingInvites` against a `users` mirror row that is temporarily deleted and re-inserted), or a `packages/core` test that executes the real insert against the local DB and asserts the helper returns `true` on the caught error.

---

_Reviewed: 2026-09-17T14:47:57Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Resolution (Phase 8, 08-08)

Closed on 2026-10-02 by plan 08-08 (D-346: the leftover Phase 2 review items are part of the
go-live hardening). Each item is either fixed with a test or recorded as superseded by the phase
that rewrites its code.

| Item | Outcome | Where |
|---|---|---|
| IN-01 | **Superseded by 08.1-06.** That plan deletes `identityConflict`, `isOneTenantPerUserViolation` and `NIL_TENANT_ID` and replaces the single-tenant refusal with a membership add, keeping only an `already_accepted` refusal for an identity already active in the inviting tenant (08.1-06-PLAN lines 95, 144, 240). A new same-tenant reason added here would be deleted one phase later. | 08.1-06 |
| IN-02 | **Superseded by 08.1-06.** The same plan rewrites the invite pre-check (`identityKind`) and moves it into the claim transaction, so the window with a false `sent` disappears with the code that has it. | 08.1-06 |
| IN-03 | **Fixed.** `/auth/confirm`'s failure path sends a link to `/convite-expirado` when `type === 'invite'` OR the sanitised `next` is `/aceitar-convite`, so a lapsed recovery-type invite link no longer lands on password recovery. Test: `apps/web/app/auth/confirm/route.test.ts`. | `ce29cba` |
| IN-04 | **Fixed.** `no_verified_primary` maps to the existing `admins.resendHelper` copy; the allow-list moved to `RESEND_REFUSAL_REASONS` / `resendReasonCopy`. Tests: `apps/web/components/platform/ResendInviteButton.test.ts`; `apps/api/tests/integration/invites.test.ts` case 14 (a SENT invite whose tenant lost its verified primary answers 409 `no_verified_primary`). | `ce29cba` |
| IN-05 | **Fixed.** The Admins tab reads `detail.invites.at(-1)` (the service keeps `asc(createdAt)`); the page and `getTenantDetail` docblocks state the ordering. Test: `invites.test.ts` case 15 (two invites, the newest is the last element). | `ce29cba` |
| IN-06 | **Fixed.** `LogoUpload` captures the recorded view inside the `try` and calls `onCompleted` and the success toast after it, so a throwing parent callback is never reported as a failed upload. Test: `LogoUpload.test.ts` case 4. | `ce29cba` |
| IN-07 | **Fixed.** `tenant-host.test.ts` case 2 ("the generic answer is served from the error TTL — no second fetch for the same host") populates its own cache with an immediate failure on its own host; it passes alone (`-t`) and under `--sequence.shuffle`. | `ce29cba` |
| IN-08 | **Unchanged.** Not in D-346's list. 08.1-06 removes `isOneTenantPerUserViolation` and the R3 case together, which retires the synthetic-only coverage this item describes. | — |
