---
phase: quick-261018-owq
verified: 2026-10-19T16:20:00Z
status: passed
score: 7/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
advisory:
  - finding: "SUMMARY frontmatter says status: incomplete; the three open failures are unrelated to this change, so the quick's own status can be raised to complete."
    category: other
    reason: "Independently shown unrelated (see Open failures)."
    evidence_status: "reproduced/inspected"
  - finding: "Hosted GoTrue behaviour (assumptions A2/A3 of the plan) cannot be verified locally; production ships both hooks disabled and the runbook step 5 smoke covers it."
    category: other
    reason: "Production is deliberately untouched by this quick."
    evidence_status: "deferred to Igor's rollout"
---

# Quick 261018-owq: Global e-mail allowlist - Verification Report

**Goal:** Only e-mails present in a new global table with status `liberado` can create an account or sign in; super_admin is exempt at login; list maintained manually via SQL; production hooks ship disabled.
**Verified:** 2026-10-19
**Status:** passed
**Re-verification:** No, initial verification
**Commits checked:** bd52795a, 834b71ae, 3ea60a11 (base 6aa2833b)

## Goal Achievement: Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Token issuance refused (403 EMAIL_NOT_ALLOWED) for unlisted/bloqueado e-mail on password, refresh, verifyOtp; liberado signs in whatever case/spaces; super_admin exempt | VERIFIED | Hook body in `supabase/migrations/20261019152008_email_allowlist_hooks.sql`: platform_admins branch first, then `lower(btrim)` lookup with `status='liberado'`, claims returned as received, else 403 envelope. Live auth container env has `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true`. I ran `email-allowlist.test.ts` against real GoTrue: 13/13 pass (cases 1-8 cover password, refresh, case/space, super_admin, verifyOtp). |
| 2 | Rejected verifyOtp is rolled back (same hash works once listed) | VERIFIED | Case 7 in the integration suite passes (13/13 run). |
| 3 | No account can be created for an unlisted e-mail on any path (signup 403, GoTrue invite/generateLink 403, createTenant 400 not_allowed, invite send/resend 403 + pending) | VERIFIED | Code read: `signup.ts` runs `isEmailAllowed` before `auth.admin.createUser`; `tenants.ts` runs it inside the tx before the tenants insert; `invites.ts` maps both `inviteUserByEmail` and resend `generateLink` refusals to 403 after `revertClaim`; `invite-send.ts` classifies as terminal. Integration run logs show `signup.not_allowed` 403, tenant create 400, `invite.not_allowed`/`invite.resend_not_allowed` 403, then resend 200 after listing. Grep of all `auth.admin.createUser/inviteUserByEmail/generateLink` call sites in `apps`/`packages` finds only signup.ts and invites.ts, all gated. |
| 4 | Screens say "Seu acesso ainda não foi liberado." (/entrar, mail links, /cadastro both branches, wizard field error), strings in pt-BR catalog | VERIFIED | Diffs read: `entrar/actions.ts` + `page.tsx`, `auth/confirm/route.ts` (placed ahead of the expired/invalid fallbacks), `cadastro/[slug]/actions.ts` (403 envelope check + `joinFromSignup`) + `page.tsx` (draft and form branches), wizard `emailNotAllowed` mapping. Messages in `messages/pt-BR/{login,signup,platform}.json`. Browser behaviour is only vouched for by the SUMMARY (e2e not rerun here, see Advisory). |
| 5 | Table is global, RLS on, zero policies, no anon/authenticated grants; hook functions SECURITY DEFINER, empty search_path, executable only by supabase_auth_admin; CHECKs on lowercase/trim and status; pgTAP 175 pins it | VERIFIED | Live DB: `relrowsecurity=t`, `relforcerowsecurity=f`, 0 policies, ACL `{postgres, service_role}` only, `has_table_privilege` false for anon/authenticated on select/insert/update/delete, no column-level grants. Both functions: owner postgres (same as table and `platform_admins`), `prosecdef=t`, `proconfig={search_path=""}`, ACL `{postgres=X, supabase_auth_admin=X}`; `has_function_privilege` false for anon, authenticated, service_role, api_user, true for supabase_auth_admin. Constraints `email_allowlist_email_lower_chk`, `email_allowlist_status_chk`, PK present. Ran pgTAP `000-helpers` + `175` (50/50 ok) and `010-rls-coverage` (4/4 ok). |
| 6 | config.toml: both hooks enabled locally, both under `[remotes.production.auth.hook.*]` `enabled = false`; SUMMARY carries the runbook and rollback | VERIFIED | `git diff` of config.toml: `[auth.hook.before_user_created]` and `[auth.hook.custom_access_token]` `enabled = true` with correct `pg-functions://postgres/public/...` URIs; `[remotes.production.auth.hook.before_user_created]` / `.custom_access_token` `enabled = false`. Auth container env confirms both `*_ENABLED=true` locally. SUMMARY "Production runbook (Igor)" has 7 steps incl. populate, locked-out query, enable, smoke, rollback, hml. Nothing pushed (no db push/config push evidence). |
| 7 | Seed users and test-harness identities are listed so suites pass with hooks on | VERIFIED | `scripts/seed.ts` `ensureUser` upserts `lower(btrim(email))` `liberado` before the GoTrue call; live seed identities log in (integration suite case 1 with seed-host membership passes; local `email_allowlist` has rows). Harness helpers `allowEmail`/`disallowEmail` present in integration `setup.ts` and e2e `admin.ts` (diff stat). SUMMARY reports full pgTAP 1860 and integration 1393/1396 (not re-run here, by instruction). |

**Score:** 7/7 truths verified.

## Specific independent confirmations requested

- **(a) Hook functions and table exposure:** confirmed live (see truth 5). Only `supabase_auth_admin` (and owner `postgres`) can execute; table has RLS on, 0 policies, no anon/authenticated grants.
- **(b) config.toml:** confirmed local `enabled = true`, production `enabled = false` for both hooks, and that the running auth container actually picked the env up.
- **(c) Refuse before side effects:** `signupMember` calls `withAdminTx(isEmailAllowed)` after the tenant/consent checks and before `supabaseAdmin.auth.admin.createUser`; `createTenant` calls `isEmailAllowed` before the `tenants` insert (after the `identityKind` platform-account refusal, which therefore keeps `in_use`). Integration cases 9-13 confirm no auth.users row / no tenant row.
- **(d) Open failures unrelated:**
  1. *3 dashboard integration tests (dashboard-snapshot INSIGHT-07 and two isolation sweeps):* the files are untouched by this change and were last modified by 08.7 commits. `SELECT count(*) FROM memberships WHERE joined_at < now() - interval '1 day'` for rede-demo returns 0, and `min(joined_at)` is today 15:52, so the "tenant-local yesterday" member count is 0 on a same-day seed. The test header itself notes the seed writes everything "now". Environmental (needs a seed older than a day); not reproduced by running the suites (not allowed), but the precondition failure is demonstrated.
  2. *courses-admin E09 mux vs fake:* the only change in `courses-admin.ts` is `await allowEmail(email)` in `createUser`; the assertion concerns the video provider the local API process runs, not auth. Environmental, matches the "Local Mux video setup" note.
  3. *signup.spec.ts test 6 (generic host link):* the spec's only changes are the `allowEmail` listing and the new owq case. The failing assertion (mail link starts with the generic host) happens after a successful sign-up, so the allowlist passed. Commit 5ea318a6 (quick 261012-s0v, an ancestor of the base 6aa2833b) deliberately re-homes that link onto the tenant host. Pre-existing, matches your reproduction at line 352.

## Status judgment

The SUMMARY's `status: incomplete` is too pessimistic. Every must-have of this quick is met and independently re-proven; the three red items are outside the allowlist change (pre-existing spec drift, a seed-age dependency of 08.7 tests, and a local Mux provider setting). The plan's literal "all suites green" gate was not met on this machine, but that is a failure of unrelated tests, not of the goal. Recommend the quick be closed as complete, with the three items tracked separately (update signup.spec test 6 to the tenant-host link; re-run the 08.7 dashboard tests on a seed older than a day; run courses-admin E09 with the fake video provider).

## Anti-patterns / hygiene

- No TBD/FIXME/XXX markers introduced in changed files (not exhaustively grepped; no stubs seen in the diffs read).
- No hook, pre-check, or existing assertion weakened in the diffs read; fixture changes are listing-only.
- Commits: author igor.vboas, no co-author or AI trailer in `git log 6aa2833b..HEAD`; no `.planning` or STATE.md paths touched.
- `git status` for `supabase apps packages scripts` is clean (no uncommitted source changes).

## Human verification

None required for the goal as scoped locally. Post-rollout (Igor, production): runbook step 5 smoke (super_admin login, listed member login, unlisted sign-up message) validates the hosted-GoTrue assumptions A2/A3 once the hooks are flipped on.

## Notes on how I ran things

- `supabase test db supabase/tests/175-email-allowlist.sql` alone fails ("schema tests does not exist") because pgTAP helpers live in `000-helpers.sql`; running `000-helpers.sql` together with `175` passes (50/50). This is a harness property, not a defect in 175 (the full-suite run loads 000 first).
- Did not run db reset/push, config push, the full suites, or any e2e.

---

_Verified: 2026-10-19_
_Verifier: Claude (gsd-verifier)_
