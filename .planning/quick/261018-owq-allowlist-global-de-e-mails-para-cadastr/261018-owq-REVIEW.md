---
phase: quick-261018-owq
reviewed: 2026-10-19T00:00:00Z
depth: standard
files_reviewed: 30
files_reviewed_list:
  - supabase/migrations/20261019152002_email_allowlist.sql
  - supabase/migrations/20261019152008_email_allowlist_hooks.sql
  - supabase/config.toml
  - supabase/tests/175-email-allowlist.sql
  - supabase/tests/010-rls-coverage.sql
  - scripts/seed.ts
  - packages/core/db/schema/email-allowlist.ts
  - packages/core/server/tenancy/email-allowlist.ts
  - packages/core/server/tenancy/signup.ts
  - packages/core/server/platform/tenants.ts
  - packages/core/server/platform/invites.ts
  - packages/core/server/platform/invite-send.ts
  - packages/core/server/http/api-error.ts
  - packages/contracts/src/allowlist.ts
  - packages/contracts/src/errors.ts
  - apps/api/src/routes/public.ts
  - apps/web/app/(auth)/entrar/actions.ts
  - apps/web/app/(auth)/entrar/page.tsx
  - apps/web/app/(auth)/cadastro/[slug]/actions.ts
  - apps/web/app/(auth)/cadastro/[slug]/page.tsx
  - apps/web/app/auth/confirm/route.ts
  - apps/web/app/(platform)/plataforma/novo/actions.ts
  - apps/web/messages/pt-BR/login.json
  - apps/web/messages/pt-BR/signup.json
  - apps/web/messages/pt-BR/platform.json
  - apps/api/tests/integration/setup.ts
  - apps/web/e2e/admin.ts
  - apps/web/e2e/wizard.ts
  - .github/workflows/deploy-api.yml
  - .github/workflows/deploy-hml.yml
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Quick 261018-owq: Code Review Report

**Reviewed:** 2026-10-19
**Depth:** standard
**Files Reviewed:** 30
**Status:** issues_found

## Summary

The core security design is sound. I found no BLOCKER. The two hook functions, the table posture
and the API pre-checks all do what the threat model asks. The three warnings are about operational
sequencing and robustness at the edges, not about a hole in the gate.

Answers to the priority questions:

1. **custom_access_token hook.** On the allowed path it returns `jsonb_build_object('claims', event->'claims')`,
   so the claims object is unchanged and every required claim is kept. The blocked path returns
   `{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}`, which is 4xx-shaped.
   A null or missing email, a missing `user_id` and a missing `claims` all fall through to the
   403 branch without raising. One exception: a non-UUID `user_id` raises in the `DECLARE` block (WR-03).
   The super_admin exemption keys on `event->>'user_id'`, which GoTrue supplies, against `platform_admins.user_id`.
   A client cannot influence it. Not spoofable.
2. **SECURITY DEFINER hardening.** Correct. `search_path = ''`, every reference is schema-qualified
   (`public.platform_admins`, `public.email_allowlist`) and only pg_catalog built-ins are used.
   EXECUTE is revoked from public, anon, authenticated and service_role and granted only to `supabase_auth_admin`.
   The table has RLS on, not forced, zero policies, and `revoke all` from anon and authenticated.
   pgTAP 175 pins all of this.
3. **Normalisation.** `lower(btrim())` is used consistently in the CHECK, both hooks, the API helper (done in SQL, not JS),
   the seed and the harness helpers. Plus-addressing is not normalised, as intended. Remaining gaps are non-ASCII only (IN-03).
4. **API pre-checks.** `signupMember` checks before `createUser`. `createTenant` checks before the `tenants` insert,
   so nothing is created on refusal. The check and the create use the same `body.email`, so there is no
   different-email race. Send and resend map to 403 `EMAIL_NOT_ALLOWED`, `classifyInviteSendError` makes it terminal,
   and the claim is reverted before the throw.
5. **Web error mapping.** It trusts only status 403 plus the exact sentinel string (`isAllowlistRejection`) or the
   API envelope code. Redirect targets are fixed literals, and messages come from the pt-BR catalogs.
   No open redirect or message injection.
6. **config.toml.** Local hooks are enabled. `[remotes.production.auth.hook.*]` is explicitly `enabled = false`.
   The URIs match the function names. See WR-02 for the gap around the not-yet-existing homolog remote.

## Warnings

### WR-01: API pre-checks go live on deploy while the production hooks stay off, so sign-up and tenant creation shut down before the list is populated

**File:** `packages/core/server/tenancy/signup.ts:209`, `packages/core/server/platform/tenants.ts:218`, `supabase/config.toml:554-560`
**Issue:** Production ships the hooks `enabled = false` so that logins do not change. The two API checks
(`signupMember`, `createTenant`) are unconditional. The first deploy therefore refuses every new sign-up (403) and
every new tenant (400 `not_allowed`) while `public.email_allowlist` is still empty. At the same time, GoTrue's own
`/auth/v1/signup` (public publishable key) and `inviteUserByEmail` stay ungated, because their hooks are off.
So production is simultaneously too closed (the API paths) and too open (the GoTrue paths) until step 4 of the runbook.
The SUMMARY documents the lockout, but it is a deploy-time behaviour change that is not behind the same flag as the hooks.
**Fix:** Either gate the API pre-check on one switch shared with the hooks (for example an `EMAIL_ALLOWLIST_ENFORCED` env
var read by `isEmailAllowed` callers, flipped together with `config push`), or document in `DEPLOY.md` that the allowlist
must be populated before the API revision is promoted, and populate it first (the table exists after `db push`, which runs before the API deploy).

### WR-02: A future `[remotes.homolog]` inherits `enabled = true` for both hooks, and nothing enforces the disabled blocks

**File:** `supabase/config.toml:549-553`, `.github/workflows/deploy-hml.yml:159-175`
**Issue:** A `[remotes.*]` table inherits the base values, and the base blocks are `enabled = true`.
The only protection against a homolog remote shipping without its own two `enabled = false` blocks is a comment
("A future [remotes.homolog] table must carry the same two disabled blocks"). The hml guard in `deploy-hml.yml` checks
`[remotes.homolog]` and its `project_id` but not the hook blocks. If someone adds the remote without them, `config push`
enables both hooks against an empty hml allowlist and every hml login answers 403 (the hml `db push` runs first, so the functions exist).
**Fix:** Add a guard step in `deploy-hml.yml` next to check (e). It should fail unless
`[remotes.homolog.auth.hook.before_user_created]` and `[remotes.homolog.auth.hook.custom_access_token]` exist.
Fail unless each of them has an explicit `enabled` line, for example:
```bash
for h in before_user_created custom_access_token; do
  grep -Eq "^\[remotes\.homolog\.auth\.hook\.${h}\]" supabase/config.toml \
    || fail "[remotes.homolog.auth.hook.${h}] missing: the base block is enabled = true"
done
```

### WR-03: The token hook can still raise on a malformed `user_id`, which would 500 every login

**File:** `supabase/migrations/20261019152008_email_allowlist_hooks.sql:50`
**Issue:** `v_user uuid := nullif(event->>'user_id', '')::uuid` runs in the `DECLARE` section, before any branch.
A `user_id` that is present but not a valid UUID raises `22P02`, which GoTrue reports as a hook failure (5xx), not
the 403 the file header promises ("4xx only"). GoTrue always sends a valid UUID today, so this is theoretical.
But the stated invariant is "never raise on an unexpected event shape", and one raise in this function locks out
everyone, super_admins included. pgTAP covers a missing `user_id` but not a malformed one.
**Fix:** Guard the cast, so that a malformed id degrades to "not an admin", then to the email check:
```sql
declare
  v_user  uuid := case when event->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then (event->>'user_id')::uuid end;
```
Add a pgTAP case with `'user_id', 'not-a-uuid'`.

## Info

### IN-01: The public sign-up endpoint is an unauthenticated oracle for allowlist membership

**File:** `packages/core/server/tenancy/signup.ts:209-217`
**Issue:** An anonymous caller learns whether any e-mail is on the customer list (403 for unlisted; 409 or 200 for listed).
CONTEXT accepts this and the log line is attributable, but there is no per-IP or per-e-mail limit specific to this check.
**Fix:** Confirm the route sits behind the existing signup rate limit. If it does not, add one.

### IN-02: A resend 403 is shown to the platform operator as a generic failure, and `lastError` renders raw

**File:** `apps/web/components/platform/ResendInviteButton.tsx:12`, `packages/core/server/platform/invite-send.ts:95`
**Issue:** `resendInviteAction` returns `{ code: 'EMAIL_NOT_ALLOWED' }` with no `reason`, and `resendReasonCopy` only knows
`email_in_use | no_verified_primary`, so the operator sees "resendFailed". The wizard path has a dedicated message; this one does not.
The worker's `lastError` is `invite:email_not_allowed`, shown raw in the Domínios card (same as the existing `invite:email_in_use`).
Also, `platformRedirectPath` correctly ignores the new 403 (it only redirects on `FORBIDDEN | TENANT_HOST_MISMATCH`), so there is no sign-out side effect.
**Fix:** Map `code === 'EMAIL_NOT_ALLOWED'` to a pt-BR message in the resend button.

### IN-03: Non-ASCII e-mails can disagree between SQL `lower()` and GoTrue's Go lowercasing

**File:** `supabase/migrations/20261019152008_email_allowlist_hooks.sql:51`, `packages/core/db/schema/email-allowlist.ts`
**Issue:** GoTrue stores the e-mail lowercased by Go (Unicode-aware). The list is normalised by Postgres `lower()`, which is
locale-dependent. Under a C-like `LC_CTYPE`, `lower('JOSÉ@x')` leaves `É`, so the listed key differs from the stored user
e-mail and that person is blocked. Fails closed, and rare.
**Fix:** Note in the runbook that non-ASCII addresses must be inserted already in GoTrue's stored form (copy from `auth.users.email`).

### IN-04: The refused-`verifyOtp` rollback is only proven for the recovery type

**File:** `apps/web/app/auth/confirm/route.ts:90-95`
**Issue:** The comment claims the one-time token is not consumed (email-allowlist.test.ts case 7). The SUMMARY says case 7
used a recovery hash. For `signup` and `invite` types, `email_confirmed_at` may be set before the hook runs if GoTrue's
transaction boundary differs. The effect is harmless for security (no session is issued), but the comment overstates what is proven.
**Fix:** Qualify the comment to "recovery", or extend case 7 to signup and invite hashes.

### IN-05: `createTenant` can still throw 403 after the tenant is committed

**File:** `packages/core/server/platform/tenants.ts:263`
**Issue:** If the admin e-mail is un-listed between the pre-check and `sendPendingInvites`, the tenant and invite already exist
and the call returns 403 `EMAIL_NOT_ALLOWED`. The wizard does not map a 403 (it treats it as a navigation), and a retry hits `slug: taken`.
It needs a human to un-list in that window, so it is rare, and the invite stays `pending` for a resend.
**Fix:** Catch `EMAIL_NOT_ALLOWED` around `sendPendingInvites` in `createTenant` and return the id anyway (the invite is resendable),
or document it.

### IN-06: Test-harness details

**File:** `apps/api/tests/integration/setup.ts:196`
**Issue:** `removeIdentitiesByPrefix` uses `like ${prefix}-%`. `_` and `%` in a prefix are wildcards, so it can delete more allowlist
rows than intended in a shared local DB. The e2e helpers also never remove the allowlist rows they add, so rows accumulate in
the local DB across runs.
**Fix:** Escape the prefix (`replace(prefix, '_', '\_')` plus `escape '\'`), and add `disallowEmail` calls to the e2e teardown.

---

_Reviewed: 2026-10-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Resolution (orchestrator, 2026-10-19)

| Finding | Outcome |
|---------|---------|
| WR-03 (uncaught uuid cast in the token hook) | **Fixed** in `5d6a3dcf`; two pgTAP cases added to 175 (51 assertions). |
| WR-01 (API pre-checks apply before the hooks are enabled) | **Open, documented.** Runbook step 1 states it; the choice (populate the list right after `db push`, or gate the API check) is Igor's. |
| WR-02 (no guard that a future `[remotes.homolog]` carries the disabled hook blocks) | **Open, documented** in runbook step 7. A `deploy-hml.yml` guard step is out of this quick's scope. |
| IN-01..IN-06 | Informational; the sign-up message oracle is an accepted decision in CONTEXT. |

