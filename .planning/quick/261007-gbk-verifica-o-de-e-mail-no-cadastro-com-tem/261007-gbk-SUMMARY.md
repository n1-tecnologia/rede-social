---
phase: quick-261007-gbk
plan: 01
subsystem: auth
tags: [auth, signup, email-verification, gotrue, send-email-hook, mail-template, pt-BR]
requires: [AUTH-01, AUTH-02, TENANT-06]
provides:
  - unconfirmed-on-create member sign-up (supersedes the autoconfirm clause of Phase 1 D-04)
  - tenant-branded pt-BR `signup` mail template and hook decision row 6a
  - /verifique-seu-email screen with constant-answer resend and 60 s cookie cooldown
status: complete
plan_head_before: 4534d7d42f816664c52ec81cedf88ba4e6f80bc1
commits: 3
key-files:
  created:
    - packages/core/server/mail/templates/signup.ts
    - apps/web/lib/mail-return-origin.ts
    - apps/web/lib/pending-confirmation.ts
    - apps/web/lib/pending-confirmation.test.ts
    - apps/web/lib/signup-confirmation.ts
    - apps/web/app/(auth)/verifique-seu-email/page.tsx
    - apps/web/app/(auth)/verifique-seu-email/actions.ts
    - apps/web/messages/pt-BR/verifyEmail.json
  modified:
    - packages/core/server/mail/index.ts
    - packages/core/server/tenancy/mail-tenant.ts
    - packages/core/server/tenancy/signup.ts
    - apps/api/src/routes/public.ts
    - supabase/config.toml
    - apps/api/tests/integration/signup.test.ts
    - packages/core/tests/mail-templates.test.ts
    - packages/core/tests/mail-link-host.test.ts
    - apps/web/app/(auth)/esqueci-senha/actions.ts
    - apps/web/app/(auth)/cadastro/[slug]/actions.ts
    - apps/web/app/(auth)/entrar/actions.ts
    - apps/web/app/auth/confirm/route.ts
    - apps/web/app/auth/confirm/route.test.ts
    - apps/web/proxy.ts
    - apps/web/proxy.test.ts
    - apps/web/e2e/mail.ts
    - apps/web/e2e/signup.spec.ts
    - apps/web/e2e/admin-rules.spec.ts
    - docs/deploy/auth-mail.md
decisions:
  - "Membership and both consent rows stay at sign-up, not at confirmation (the hook brands from the membership; consent evidence belongs to the moment of acceptance)."
  - "The web tier triggers the mail with supabase.auth.resend type signup because GoTrue sends nothing on admin createUser; resend does not reopen CR-02."
  - "Hook row 6a: hostless signup + exactly one membership brands that tenant; rows 1-9 otherwise unchanged."
---

# Quick 261007-gbk: E-mail verification on member sign-up

Sign-up now creates an unconfirmed GoTrue identity, sends a tenant-branded pt-BR "Confirme seu e-mail" mail through the existing Send Email Hook, and ends on `/verifique-seu-email` instead of auto signing in. The mail link confirms the e-mail, signs in and lands on `/inicio`.

## Tasks and commits

| Task | Commit | What |
|------|--------|------|
| 1 | `1bad76a` | `renderSignup` template + `render()` case, hook row 6a, `createUser` with `email_confirm: false`, `enable_confirmations = true` locally and in `[remotes.production]` (`max_frequency = "60s"`), integration cases 11-13 |
| 2 | `b8cbebf` | `mailReturnOrigin` extracted from the recovery action, `pending_confirmation` cookie codec + cooldown + `isEmailNotConfirmed`, `sendSignupConfirmation`, `/verifique-seu-email` page + `resendConfirmation` action + `verifyEmail.json`, sign-up/login/join changes, `/auth/confirm` signup fallback, proxy public path |
| 3 | `2bda0a0` | e2e (`signup.spec.ts` cases 1, 2, 6 rewritten, new 9-11; `admin-rules.spec.ts`; `mail.ts` helpers `waitForSignupMail`, `mailCount`) and `docs/deploy/auth-mail.md` |

Docs artifacts (this SUMMARY, STATE, PLAN) were left uncommitted for the orchestrator, as instructed.

## Verification (real output)

- Local stack restarted with `pnpm supabase stop && pnpm supabase start` (database kept, no reset). GoTrue settings now report `"mailer_autoconfirm":false`.
- `@rede-social/core`: `vitest run tests/mail-templates.test.ts tests/mail-link-host.test.ts` 39 passed (red first, then green); full core suite 39 files / 403 tests passed.
- `@rede-social/api`: `vitest run tests/integration/signup.test.ts tests/integration/send-email-hook.test.ts tests/integration/gotrue-signup-disabled.test.ts` 3 files / 38 tests passed (new cases 11 unconfirmed sign-in with `email_not_confirmed` vs `invalid_credentials`, 12 resend through hook to Mailpit then `verifyOtp` signup then sign-in, 13 hostless redirect still branded). Also `member-admin.test.ts` + `admin-rules.test.ts`: 56 passed.
- `@rede-social/web`: targeted unit run (pending-confirmation, confirm route, proxy, messages, join-draft) 791 passed; full web vitest 101 files / 2006 tests passed.
- typecheck and Biome lint green for core, api and web; `bash scripts/check-ui-literals.sh` OK.
- Playwright `mobile-chromium` (local stack, `SEED_PASSWORD=Segredo123`): `signup.spec.ts` 11/11 passed; `admin-rules.spec.ts` + `recovery.spec.ts` + `multi-tenant-identity.spec.ts` 31/31 passed.
- grep checks: `email_confirm: false` count in `signup.ts` = 1 (the `email_confirm: false` key; the doc comment spells it differently); `signInWithPassword` count in `cadastro/[slug]/actions.ts` = 1 (only `joinFromSignup`); `mailReturnOrigin` count in `esqueci-senha/actions.ts` = 3; "6a" in `auth-mail.md` = 3.

Not run, by design: full `pnpm verify`, manual Mailpit visual spot check of logo/colour (the mail renders through the same `renderLayout` as recovery; headers, subject and link are asserted by tests), any deploy or `supabase config push`.

## Deviations from Plan

None of Rules 1-4 triggered. Small notes:

- Plan step 8 (raise local `[auth.rate_limit] email_sent`) was NOT needed: `over_email_send_rate_limit` never appeared, so that key is untouched. The failure-modes table in `auth-mail.md` still lists it as a possible symptom.
- Added `mailCount(email)` to `apps/web/e2e/mail.ts` (not named in the plan) so e2e case 10 can assert that the cooldown click sent no new mail.
- `pnpm exec biome check --write .` inside `apps/web` was run once; it reported "Fixed 3 files". Only my own new/edited files should be affected; the pre-existing uncommitted files (MediaLibrary.tsx, e2e specs, csp.*, DEPLOY.md) were not staged or committed.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-gbk-01..08). New public surface is `/verifique-seu-email` (public path in `proxy.ts`), covered by T-gbk-01 (constant answer), T-gbk-03 (cooldown) and T-gbk-06 (cookie).

## Follow-ups / risks carried from the plan

- Unconfirmed members appear in admin member lists until they confirm (not filtered here).
- Production gets `enable_confirmations` and `max_frequency = "60s"` only on the next `supabase config push`; that push must come after the web release that ships `/verifique-seu-email`. Homolog's remote table (not yet defined in `config.toml`) must repeat the same two keys.
- Sign-up on an unregistered host (Vercel Preview alias) cannot get its mail (`signup_confirmation.origin_refused`), same rule as recovery.

## Self-Check: PASSED

- Commits `1bad76a`, `b8cbebf`, `2bda0a0` exist on `master` (3 commits since `plan_head_before`), none carries a Co-Authored-By line.
- Created files exist (template, lib files, page, action, catalog, test).
