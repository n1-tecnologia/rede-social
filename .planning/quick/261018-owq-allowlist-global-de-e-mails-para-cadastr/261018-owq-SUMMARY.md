---
phase: quick-261018-owq
plan: 01
subsystem: auth
tags: [security, auth, supabase, auth-hooks, gotrue, allowlist, migration, rls, pgtap, config, e2e, quick]
status: complete
requirements-completed: [AUTH-01, AUTH-02, ROLE-03]
commits: 4
plan_head_before: 6aa2833ba593e56032d286cbe06257f857b670bf
actuals:
  tokens: 26700
  tasks: 3
  commits: 3
key-files:
  created:
    - packages/core/db/schema/email-allowlist.ts
    - supabase/migrations/20261019152002_email_allowlist.sql
    - supabase/migrations/20261019152008_email_allowlist_hooks.sql
    - supabase/tests/175-email-allowlist.sql
    - packages/contracts/src/allowlist.ts
    - packages/contracts/tests/allowlist.test.ts
    - packages/core/server/tenancy/email-allowlist.ts
    - apps/api/tests/integration/email-allowlist.test.ts
  modified:
    - supabase/config.toml
    - scripts/seed.ts
    - packages/core/server/tenancy/signup.ts
    - packages/core/server/platform/tenants.ts
    - packages/core/server/platform/invites.ts
    - packages/core/server/platform/invite-send.ts
    - apps/web/app/auth/confirm/route.ts
completed: 2026-10-19
---

# Quick 261018-owq: global e-mail allowlist for sign-up and login - Summary

**Only an e-mail listed `liberado` in the new global `public.email_allowlist` can create an account or receive a token: a `custom_access_token` hook (every grant), a `before_user_created` hook (GoTrue's own creation paths) and API pre-checks (GoTrue's `admin.createUser` skips the creation hook), with "Seu acesso ainda não foi liberado." on /entrar, /cadastro, the mail links and the platform wizard. Hooks are ON locally and explicitly `enabled = false` under `[remotes.production]`.**

## Status: incomplete (open items, none caused by this quick)

All three tasks are implemented and committed, and every test this quick adds or touches passes. `status` is `incomplete` only because three literal gates did not come out fully green on this machine today, each for a reason outside this change (details under "Gate results"):

1. `pnpm test:integration` (api): 1393 of 1396 pass on a same-day fresh `db:reset` + `db:seed`. The 3 failures are 08.7 dashboard tests that need seed rows older than a day (`dashboard-snapshot` INSIGHT-07 and two `isolation` dashboard sweeps). They pass on an aged seed.
2. e2e `courses-admin.spec.ts:3021` (E09 .mov under "fake" provider) fails because the API ran the `mux` video provider locally (environment).
3. e2e `signup.spec.ts:331` ("generic host keeps /cadastro/{slug}") fails because quick 261012-s0v deliberately re-homes the generic-host sign-up link onto the tenant host and never updated this spec's expectation (pre-existing).

## What was built

### Task 1 (tracer): token issuance gated end to end — `fda819c6`
- `public.email_allowlist` (Drizzle schema + generated migration): `email text PK`, `status text default 'liberado'`, timestamps, CHECKs `status in ('liberado','bloqueado')` and `email = lower(btrim(email))`, RLS on, **zero policies**, plain `text` (not citext: its `=` is case-sensitive under an empty `search_path`).
- Custom migration `*_email_allowlist_hooks.sql`: `revoke all` on the table from anon/authenticated; `public.hook_custom_access_token_allowlist(jsonb)` (super_admin first, then listed-`liberado`, claims returned unchanged, else `{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}`) and `public.hook_before_user_created_allowlist(jsonb)` (`'{}'` or the same error); both SECURITY DEFINER, owner postgres, `search_path = ''`, EXECUTE revoked from public/anon/authenticated/service_role and granted only to `supabase_auth_admin`; `grant usage on schema public to supabase_auth_admin`.
- `supabase/config.toml`: `[auth.hook.before_user_created]` and `[auth.hook.custom_access_token]` enabled locally; the same two blocks under `[remotes.production.auth.hook.*]` with `enabled = false`.
- `@rede-social/contracts` `ALLOWLIST_REJECTION_MESSAGE` / `isAllowlistRejection` (status 403 + exact sentinel).
- pgTAP `175-email-allowlist.sql` (49 assertions) + `('email_allowlist')` in `010-rls-coverage.sql`.
- `scripts/seed.ts` `ensureUser` upserts every seed identity (`lower(btrim(email))`, `liberado`).
- `apps/api/tests/integration/setup.ts`: `allowEmail` / `disallowEmail`, `authAdmin().createUser` lists the fixture e-mail first (one choke point for ~21 sites), `removeIdentitiesByPrefix` clears list rows.
- `apps/api/tests/integration/email-allowlist.test.ts` cases 1-8 against real GoTrue.
- `/entrar`: `erro=nao-liberado` alert (`login.notAllowed`); e2e `allowEmail`/`disallowEmail` helpers and a `261018-owq` login case.

### Task 2: account creation refused in the API — `7563f991`
- `EMAIL_NOT_ALLOWED` error code + pt-BR message; kernel helper `isEmailAllowed(tx, email)` (SQL-side `lower(btrim())`).
- `signupMember`: pre-check after the consent check and before `admin.createUser` (403, `signup.not_allowed` warn without the e-mail; runs before the duplicate path so an unlisted existing identity gets 403, not 409), plus an `isAllowlistRejection(created.error)` branch.
- `createTenant`: pre-check after `identityKind` and before the tenants insert: 400 `VALIDATION_FAILED { adminEmail: 'not_allowed' }`.
- Invites: `inviteUserByEmail` and resend `generateLink` refusals map to 403 `EMAIL_NOT_ALLOWED` (claim reverted, invite stays pending/sent, nothing created); `classifyInviteSendError` returns `{ retry: false, lastError: 'invite:email_not_allowed' }` (unit test written RED first).
- Integration cases 9-13 (written RED first against Task 1's code, then GREEN) and fixture listing in the affected suites.

### Task 3: creation screens + e2e harness — `868ddcee`
- `/auth/confirm`: `isAllowlistRejection(error)` -> `/entrar?erro=nao-liberado`, ahead of the /convite-expirado and link-invalido fallbacks (3 new route.test.ts cases, RED first).
- `/cadastro/[slug]`: 403 `EMAIL_NOT_ALLOWED` -> `?erro=nao-liberado`; `joinFromSignup` maps the hook refusal to `&erro=nao-liberado` (was "Senha incorreta"); alert in both the draft and the form branches (`signup.notAllowed`).
- Wizard: `DraftFieldError` gains `emailNotAllowed`, mapped from `details.adminEmail === 'not_allowed'` (`platform.new.errors.emailNotAllowed`).
- e2e harness: `createMember` and the four `*-admin.ts` helpers, `wizard.ts` `fillTenantData`, and the specs that type fresh addresses list them first; two new `261018-owq` cases (refused /cadastro, refused wizard admin).

## Observed GoTrue error shape (local v2.197.0)
A hook refusal reaches supabase-js as `AuthApiError` with `status === 403`, `message === 'EMAIL_NOT_ALLOWED'` (never 5xx), for password sign-in, `refreshSession`, `verifyOtp`, `inviteUserByEmail` and `generateLink`. A refused `verifyOtp` is rolled back: the same recovery hash succeeds once the e-mail is listed (case 7). The API's own envelope is `{ error: { code: 'EMAIL_NOT_ALLOWED', message: 'Seu acesso ainda não foi liberado.' } }`.

## Harness choke points changed
- `scripts/seed.ts` `ensureUser` (all seed identities, super admin, removed-member and reuse-fixture logins).
- `apps/api/tests/integration/setup.ts` `authAdmin()` wrapper (`createUser` lists first), `allowEmail` / `disallowEmail`, `removeIdentitiesByPrefix`.
- `apps/web/e2e/admin.ts` `createMember` + `allowEmail` / `disallowEmail`; `feed-admin.ts`, `events-admin.ts`, `members-admin.ts`, `courses-admin.ts` `createUser`; `wizard.ts` `fillTenantData`.

## Beyond the planned file list (forced by the gate runs, all "list the fixture's address")
- `apps/api/tests/integration/platform-branding.test.ts` test 7 posts `/v1/platform/tenants` directly (not via `createThrowawayTenant`): found red in the first full integration run, fixed with `allowEmail`.
- `apps/api/tests/integration/platform-tenants.test.ts`: the `platform()` helper lists any `adminEmail` it posts to `/tenants`; the two direct `createTenant` service calls (tests 1 and 2) list theirs (test 2 needed it so the "slug taken" refusal still wins).
- `apps/web/e2e/phase2-smoke.spec.ts` types the admin e-mail straight into the wizard: found red in the e2e run, fixed with `allowEmail`.
- `apps/api/tests/integration/member-admin.test.ts` MODER-02: listed before the sign-up attempt (its subject is already listed through the `authAdmin()` wrapper; kept for explicitness).
- No hook, pre-check or existing assertion was weakened anywhere.

## Gate results (real counts)

| Gate | Result |
|---|---|
| `pnpm db:generate` drift | "No schema changes, nothing to migrate" |
| Auth container env | `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true`, `GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED=true` |
| config.toml | local blocks `enabled = true`; both `[remotes.production.auth.hook.*]` `enabled = false` |
| pgTAP (`supabase test db`) | PASS, 36 files, 1860 tests, on three fresh resets (175 and 010 included) |
| contracts allowlist unit test | 5/5; contracts suite 184/184 |
| core unit | 440/440 (invite-send 7/7 incl. the new classifier case) |
| api unit | 67/67 |
| typecheck + lint (api, core, contracts, web) | green; `guard:lanes` OK; `check-ui-literals` OK |
| `email-allowlist.test.ts` | 13/13 (cases 1-13) against real GoTrue |
| web unit | 170 files, 3831/3831 (route.test.ts 15/15) |
| e2e helper-listing completeness check | OK |
| api integration, fresh reset+seed, same day | 1393/1396. FAIL: `dashboard-snapshot` INSIGHT-07, `isolation` "phase 08.7 sweep: dashboard owner" and "dashboard activity" |
| reuse-fixture integration | 1/1 |
| e2e, 17 specs, mobile-chromium, fresh reset+seed | first run 210 passed, 6 skipped, 4 failed; after fixing phase2-smoke and a disk-full ENOSPC rerun: phase2-smoke, platform-tenants and signup specs 25 passed, 1 failed |
| new `261018-owq` e2e cases | login, signup (/cadastro refusal) and platform-tenants (wizard refusal) all pass |

### The failing items, and why they are not this change
1. **08.7 dashboard tests (3)**: they read the tenant-local "yesterday". The `dashboard-snapshot` failure is `body.members.count` = 0 (assertion `toBeGreaterThan(0)`), because a seed written today has `memberships.joined_at` of today. The `isolation` sweeps additionally need a post and a story from yesterday. With seed rows aged past a day, `dashboard-snapshot` and `isolation` passed (isolation 66/66) while this change was in place. They need a seed at least a day old (they pass tomorrow without any change). Note: my diagnostic aging also pushed stories past their 24 h window and broke the stories suites for one run; I then re-did a clean `db:reset` + `db:seed` and the 1393/1396 above is from that clean state.
2. **`courses-admin.spec.ts:3021`**: `expect(asset.provider).toBe('fake')` received `'mux'`: the local API ran the Mux provider. Environment (see memory "Local Mux video setup"), unrelated to the allowlist.
3. **`signup.spec.ts:331`**: expects the generic-host sign-up link to start with the generic host; the mail links to `rede-demo.localhost:3000`. Quick 261012-s0v (`5ea318a6`) re-homes exactly that link on purpose and did not update this spec. Pre-existing.

## Deviations from Plan

**1. [Rule 3 - Blocking] Disk full during the e2e run.** A Playwright test aborted with `ENOSPC` (277 MiB free). Removed `apps/web/.next/cache` and `apps/web/.next/dev` (no `next dev` running), reran the affected specs. No source change.

**2. [Rule 1 - Bug in harness] Three fixtures needed listing beyond the planned set** (see "Beyond the planned file list"): platform-branding test 7, the platform-tenants helper/service calls, phase2-smoke.

**3. [Process] Same-day seed false negatives** in the 08.7 dashboard tests (above). Not fixed, not weakened.

## Known Stubs
None.

## Threat Flags
None beyond the plan's threat model. The two new definer functions and the new table are the planned surface (T-owq-01..11).

## Production runbook (Igor)

Production is not touched by this quick. Nothing was pushed, no `db push`, no `config push`.

1. **Push.** `deploy-api.yml` runs `supabase db push --include-roles` (creates `public.email_allowlist` and both hook functions) and then `supabase config push`, which sends both hooks with `enabled = false`: logins do not change. Note: **the API-side checks are live as soon as the new API revision deploys, even while the hooks are still off.** Sign-ups and tenant first-admins whose e-mail is not listed are refused (403 / wizard field error) from that moment. This is the intended policy and locks out no existing account, but populate the list (step 2) quickly after the deploy if people must keep signing up or you create tenants.
2. **Populate** in the SQL Editor of project `qjjhtduxquvlfppybpqq`, one upsert per e-mail:
   ```sql
   insert into public.email_allowlist (email, status) values (lower(btrim('x@y')), 'liberado')
   on conflict (email) do update set status = excluded.status, updated_at = now();
   ```
   To block someone, upsert the same e-mail with status `bloqueado`.
3. **Who would be locked out** (run before enabling; it must list only people you intend to block):
   ```sql
   select u.email from auth.users u
    where not exists (select 1 from public.platform_admins pa where pa.user_id = u.id)
      and not exists (select 1 from public.email_allowlist a
                       where a.email = lower(btrim(u.email)) and a.status = 'liberado');
   ```
4. **Enable.** Flip `enabled = false` to `enabled = true` in both `[remotes.production.auth.hook.before_user_created]` and `[remotes.production.auth.hook.custom_access_token]` in `supabase/config.toml`. Commit and push so the deploy runs `config push`, or run `supabase config push --project-ref qjjhtduxquvlfppybpqq --yes` by hand.
5. **Smoke.** (a) the super_admin logs in; (b) a listed member logs in; (c) an unlisted throwaway sign-up shows "Seu acesso ainda não foi liberado."; (d) assumptions A2/A3 hold (hosted GoTrue keeps the hook contract and the definer reads both tables).
6. **Rollback.** Set both blocks back to `enabled = false` and `config push`, or switch the hooks off in Dashboard -> Authentication -> Hooks. A block applies on the next token refresh (about 1 h or less).
7. **hml.** There is no `[remotes.homolog]` today. When it is added, carry both hook blocks with `enabled = false` until hml's own list is populated, and apply the same migration there first. The hml project also needs its own populated list before its hooks are enabled.

Order rule: the functions must exist before any hook is enabled (GoTrue answers 500 on every login otherwise). `deploy-api.yml` already runs `db push` before `config push`.

## Self-Check: PASSED
- Files exist: schema, both migrations, pgTAP 175, contracts allowlist + test, kernel helper, integration suite, this summary.
- Commits exist: `fda819c6`, `7563f991`, `868ddcee` (3, matches `git rev-list --count 6aa2833b..HEAD`); authored by igor.vboas, no co-author trailer, none touches `.planning/phases/08.7-*` or STATE.md.

## Post-execution addendum (orchestrator, 2026-10-19)

- **Status raised to `complete`.** The verifier returned `passed` 7/7 (`261018-owq-VERIFICATION.md`). The three open gates are not caused by this change: the two 08.7 dashboard integration sweeps and `dashboard-snapshot` need a seed older than one day (the DB had 0 memberships older than 1 day); `courses-admin` E09 is the local Mux-vs-fake provider; `signup.spec.ts` test 6 fails at the mail-link host assertion (line 352) AFTER the sign-up succeeded, because quick 261012-s0v re-homes that link on purpose. The orchestrator reproduced test 6 alone and got the same line-352 failure.
- **Review (`261018-owq-REVIEW.md`): 0 blocker, 3 warnings, 6 info.** WR-03 fixed in `5d488145`: `hook_custom_access_token_allowlist` casts `user_id` only when it is a well-formed uuid (a malformed id would have raised and answered 500 on every login). pgTAP 175 now has 51 assertions; `000-helpers` + `175` + `010` pass 56/56; `email-allowlist.test.ts` 13/13 against the real local GoTrue. The fixed function was applied to the local DB with `create or replace` (no reset), so the local state matches the migration file.
- **Open, decision for Igor:**
  - **WR-01.** The API pre-checks in `signupMember` and `createTenant` are unconditional, so they apply from the first API deploy even while both production hooks are off: until the list is populated, new sign-ups and new tenant first-admins are refused. Existing accounts keep logging in. Populate the list right after `db push` (runbook step 2), or ask for the API check to be gated on the same switch as the hooks.
  - **WR-02.** `config.toml` base hook blocks are `enabled = true` and `[remotes.*]` inherit them. A future `[remotes.homolog]` must carry the two `enabled = false` blocks (runbook step 7); `deploy-hml.yml` does not guard this yet.
- **Follow-ups outside this quick:** update `signup.spec.ts` test 6 for the re-homed link host; re-run the 08.7 dashboard integration suites on a seed older than a day; run `courses-admin` E09 under the fake video provider. Local DB is a fresh reset + seed (today's seed) with both hooks enabled.
