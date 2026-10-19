# Quick 261018-owq: Allowlist global de e-mails para cadastro e login - Research

**Researched:** 2026-10-18
**Domain:** Supabase Auth hooks (Postgres functions), GoTrue error propagation, repo migrations/tests
**Confidence:** HIGH. The hook behaviour was read in GoTrue source at the exact version the local stack runs, and the SQL was probed on the live local DB.

## Summary

**The biggest finding contradicts CONTEXT.md.** `before_user_created` does **not** fire for `auth.admin.createUser`. GoTrue's `adminUserCreate` never calls `triggerBeforeUserCreated`. This holds at the local version (v2.197.0) and on the current `master` (`admin.go` last changed 2026-08-31, zero calls). The hook fires only for `/invite` (`inviteUserByEmail`), `generateLink` of type `signup`/`invite` when the user does not exist yet, public `/signup`, anonymous, OAuth/SSO/web3 and OIDC. [VERIFIED: github.com/supabase/auth v2.197.0 `internal/api/{admin,invite,mail,signup}.go`, grep output below]. So the main creation path, `packages/core/server/tenancy/signup.ts:200` (`admin.createUser`), is **not** covered by the hook. The API needs its own allowlist pre-check there. That pre-check is also the only way to give the friendly 403, because a hook rejection on that path would never happen. On the good side, the seed, the 20 integration `createUser` sites and the 5 e2e `POST /auth/v1/admin/users` helpers are **not** affected by `before_user_created` at all.

`custom_access_token` runs inside the same DB transaction as every token issuance: password grant, `verifyOtp` (`verifyPost`) and refresh (`RefreshTokenGrant`). A rejection rolls back the whole transaction. For `verifyOtp` this means the e-mail stays unconfirmed and the one-time token stays unconsumed, so the same link works once the e-mail is listed. [VERIFIED: GoTrue `verify.go:242-290`, `tokens/service.go:598,735-755,944`]. A rejection reaches supabase-js as `AuthApiError` with `status = http_code`, `code = 'unknown'` (any 4xx without an error_code) and `message = <hook message>`. The web layer must therefore match on **status 403 + an exact sentinel message**.

The hooks are called as `supabase_auth_admin`. That role has no RLS bypass and no table grants. `platform_admins` is pinned at ZERO policies by `supabase/tests/040`, so the hook functions must be `SECURITY DEFINER` (owner `postgres`) with `search_path = ''`. This follows the repo's 102 existing definers. It goes against the docs' "avoid security definer" advice, and the reason is above. A prototype was probed on the local DB (rolled back): under `supabase_auth_admin` the definer reads both tables, a direct table read is denied, and anon/authenticated have no EXECUTE.

**Primary recommendation:** Use three layers:
1. An API pre-check in `signupMember` that returns 403 `EMAIL_NOT_ALLOWED`.
2. The `before_user_created` hook for the GoTrue creation paths (invite, generateLink, any future path).
3. The `custom_access_token` hook as the backstop on every token.

Both hooks are `SECURITY DEFINER` functions in `public`. The table is plain `text` with a lowercase CHECK constraint, not `citext`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- List scope: Global — one list for the whole platform, no `tenant_id`.
- List maintenance: Populated manually via SQL by Igor. No admin UI, no API endpoint.
- Existing accounts: Nobody is actually using the platform yet; no backfill migration. Igor adds any existing user's e-mail by hand afterwards.
- Exemptions: `super_admin` (rows in `platform_admins`) is exempt from the login check. Everyone else must be listed, including tenant admins invited via platform invites and buyers coming from store flows. At creation time the role is not known yet; a new super_admin account must have its e-mail on the list (or be created before the hook is enabled).
- Status values: Only `liberado` and `bloqueado`. Absent e-mail behaves like blocked. Blocking takes effect on the next token issuance/refresh (≤ access-token TTL, ~1 h). Accepted.
- E-mail matching: Case-insensitive (normalize to lowercase on write and compare lowercase/trimmed).
- UX messages: pt-BR, e.g. "Seu acesso ainda não foi liberado." on both signup and login, instead of a generic error. Accepted that signup reveals whether an e-mail is on the list.
- Rollout: Push and production deploy (migration + enabling hooks on the hosted project) are done by Igor. Plan must document the production steps and the "populate the list before enabling hooks" ordering.

### Claude's Discretion
- Seed and tests: local hooks will block seed users and every test that creates users. Recommended approach: seed inserts all seed e-mails as `liberado`, and shared test helpers that create users insert the e-mail into the allowlist first. Keep the hooks enabled locally so the behavior is tested. Planner/researcher should size how many helpers/suites create users.
- Exact table/function names, enum vs check constraint, hook error codes/messages mapping, and how the web layer detects the hook rejection.
- Whether the hook functions must be `security definer` / grants to `supabase_auth_admin` (follow Supabase hook docs).

### Deferred Ideas (OUT OF SCOPE)
- Management UI for the list, immediate-revocation check in the API auth middleware, a `pendente` status, per-tenant lists.
</user_constraints>

**Correction to a CONTEXT.md premise.** The scope line says `before_user_created` "Covers `packages/core/server/tenancy/signup.ts` (`auth.admin.createUser`)". That is false (see Summary). The planner must add the API pre-check to honour the locked decision "only listed e-mails can create an account". Without it, an unlisted person can still create an identity through `/cadastro`. They can never get a token, but they get the "confirm your e-mail" flow and a mail.

## Project Constraints (from CLAUDE.md)
- All business logic goes through the API. The web talks to Supabase only for Auth via `@supabase/ssr` and for read-only Realtime.
- The Drizzle TS schema is the source of truth. Generate with `pnpm db:generate --name=<x>`. Hand-written SQL goes in a custom migration in the same folder. Only the Supabase CLI applies migrations (never `drizzle-kit migrate`/`push`). [CITED: packages/core/docs/SCHEMA-CONVENTIONS.md (h) 1-4]. In practice custom migrations sit in drizzle's `_journal.json`: `data_api_closed_schema`, `membership_email_unconfirmed` and `identity_has_password` are all journaled. So use `pnpm db:generate --custom --name=<x>`. [VERIFIED: supabase/migrations/meta/_journal.json grep]
- `withAdminTx` is kernel-only (`packages/core/server/{tenancy,platform}`, `scripts/`). `signup.ts`, `invites.ts`, `tenants.ts` and `seed.ts` may use it.
- Every setting is LOCAL. `pnpm guard:lanes` greps `set role` without `local`. The hook functions must not `set role`.
- pt-BR UI strings live in the next-intl catalog `apps/web/messages/pt-BR/*.json`. `scripts/check-ui-literals.sh` exists, so put no literals in components.
- Commits are path-scoped. Do not touch `.planning/phases/08.7-*` or STATE.md. No Claude co-author trailer (user memory: public repo).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Allowlist storage | Database (`public.email_allowlist`, RLS on, 0 policies) | — | Same invisible-table shape as `platform_admins` |
| Block account creation, sign-up form | API (`signupMember` pre-check via `withAdminTx`) | DB hook (no-op on this path) | `admin.createUser` bypasses `before_user_created` |
| Block account creation, invites/generateLink | DB hook `before_user_created` | API pre-check in `createTenant` (optional, friendlier) | GoTrue `/invite` and `/admin/generate_link` fire the hook |
| Block token issuance (login, verifyOtp, refresh) | DB hook `custom_access_token` | — | The only place every token passes |
| Friendly message | Web (server actions + `/auth/confirm` + next-intl) | API `ERROR_MESSAGES` | Maps 403 `EMAIL_NOT_ALLOWED` / AuthApiError sentinel |

## Findings

### 1. Hook contracts (GoTrue v2.197.0, the image the local stack runs: `public.ecr.aws/supabase/gotrue:v2.197.0`)

**Where `before_user_created` fires.** [VERIFIED: GoTrue source v2.197.0, plus `admin.go` on master]
```
invite.go:61   a.triggerBeforeUserCreated(r, db, user)        # POST /invite (inviteUserByEmail), only when the user does not exist
mail.go:122    ... signupUser                                  # generateLink type=signup, user == nil
mail.go:138    ... inviteUser                                  # generateLink type=invite, user == nil
signup.go:186  ... signupUser                                  # POST /signup (disabled here: enable_signup = false)
admin.go       (no trigger call at all)                        # POST /admin/users = auth.admin.createUser -> NOT covered
```
- Input: `{ "metadata": {uuid,time,name,ip_address}, "user": <auth.users shape> }`. The e-mail is at `event->'user'->>'email'`, and the user does not exist in Postgres yet. [VERIFIED: v0hooks.go:57-60; CITED: supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook]
- Allow: return `'{}'::jsonb`. Reject: `{"error":{"http_code":403,"message":"..."}}`.
- The hook runs **outside** the creation transaction (`checkTX` refuses a tx). On rejection nothing is written and no mail is sent.

**`custom_access_token`.**
- Input: `{ metadata, user_id, claims, authentication_method }`. Methods include `password`, `otp`, `token_refresh`, `invite`, `recovery`, `email/signup`. [VERIFIED: v0hooks.go:168-173; CITED: custom-access-token-hook docs]
- Output must contain `claims`. If it does not, GoTrue answers 500 "output claims field is missing" (v0hooks.go:199-206).
- `validateTokenClaims` then checks the required claims: `iss aud exp iat sub role aal session_id email phone is_anonymous`. **Return `jsonb_build_object('claims', event->'claims')` unchanged.** Do not add or drop claims.
- The error check (`hookserrors.Check`) runs **before** the output is unmarshalled, so an error object without `claims` is fine.
- `claims.email` is `params.User.GetEmail()`, but compare by `user_id` for the super_admin exemption.

**Error propagation.** [VERIFIED: hookserrors.go `check()`; api/errors.go:162-181; auth-js 2.116.0 fetch.js:51-88]
- The hook returns `{error:{http_code:403,message:M}}`. GoTrue builds an `HTTPError{HTTPStatus:403, Message:M}` with no ErrorCode.
- supabase-js sends `X-Supabase-Api-Version: 2024-01-01`, so GoTrue answers `403 {"code":"unknown","message":M}`.
- supabase-js turns that into `AuthApiError(M, 403, 'unknown')`.
- **`http_code` must be 4xx.** A 5xx becomes `AuthRetryableFetchError` (fetch.js:51-53), which auto-refresh retries. A missing `http_code` defaults to 500.
- **Detection rule for the web/API:** `error.status === 403 && error.message === 'EMAIL_NOT_ALLOWED'`. Put the sentinel string in `@rede-social/contracts` and pin it in pgTAP, because SQL cannot import it.

**Transactions and timeout.** [VERIFIED: hookspgfunc.go; CITED: auth-hooks docs]
- The pg hook runs `set local statement_timeout TO '2000'; select <schema>.<fn>(?);` inside GoTrue's transaction.
- An uncaught SQL exception becomes a 500 for **every** login.

**Order inside sign-in.** The password and the `email_not_confirmed` check come before `IssueRefreshToken` → `GenerateAccessToken` (service.go:944). So the "não liberado" answer is only ever shown to someone who typed the right password. Login therefore gains no existence oracle. [VERIFIED for the issuance call site; the order is also pinned by the existing `signup.test.ts` case 11 per the comment in `entrar/actions.ts`]

**CLI / config.**
- The pinned CLI 2.117.0 knows `hook_before_user_created_{enabled,uri,secrets}` and `hook_custom_access_token_*`. [VERIFIED: `grep -ao` on `node_modules/.pnpm/@supabase+cli-darwin-arm64@2.117.0/.../bin/supabase`]
- Local syntax: [CITED: supabase.com/docs/guides/auth/auth-hooks]
```toml
[auth.hook.before_user_created]
enabled = true
uri = "pg-functions://postgres/public/hook_before_user_created_allowlist"

[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/hook_custom_access_token_allowlist"
```
- The commented templates already sit at `supabase/config.toml:351-359`. Quoted verbatim: `# [auth.hook.before_user_created]` / `# uri = "pg-functions://postgres/auth/before-user-created-hook"` / `# [auth.hook.custom_access_token]` / `# uri = "pg-functions://<database>/<schema>/<hook_name>"`. [VERIFIED: supabase/config.toml:351-359]
- **Remote tables inherit base values.** The repo documents this at config.toml:530 ("A remote table inherits the base values, so these are repeated explicitly"), and quick 261007-gbk PLAN:162 says the same. So enabling the base blocks also enables them on `production` at the next `supabase config push`.
- Add explicit `[remotes.production.auth.hook.before_user_created]` / `[remotes.production.auth.hook.custom_access_token]` blocks (same uri, `enabled = true`) next to the existing `[remotes.production.auth.hook.send_email]` (config.toml:536-539). They serve clarity and give Igor a rollout toggle (see Rollout).
- Editing hook blocks needs `pnpm supabase stop && pnpm supabase start`, because they are auth container env (config.toml comment at ~369-372).
- No `secrets` key is needed for pg-functions hooks.

### 2. Migrations, schema, RLS, tests in this repo

**Table (Drizzle, `packages/core/db/schema/email-allowlist.ts` + export in `schema/index.ts`).** Recommended shape:
- `email text primary key` (manual SQL `on conflict (email)`).
- `status text not null default 'liberado'`.
- `created_at` and `updated_at` as `timestamptz not null default now()`. Same pattern as `tenants.ts:30` `updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()`. [VERIFIED: tenants.ts:30]
- `check('email_allowlist_status_chk', sql\`${t.status} in ('liberado','bloqueado')\`)`, the repo's CHECK style, e.g. tenant-invites.ts:45 `check('tenant_invites_status_chk', sql\`${t.status} in ('pending','sent','accepted','expired')\`)`. [VERIFIED: packages/core/db/schema/tenant-invites.ts:44-45]
- `check('email_allowlist_email_lower_chk', sql\`${t.email} = lower(btrim(${t.email}))\`)`.
- `.enableRLS()` with **no** `pgPolicy`.

**Do NOT use `citext`** even though `tenant_invites.email` does. citext lives in schema `extensions` (`create extension if not exists citext with schema extensions;`, [VERIFIED: supabase/migrations/20260912030541_app_helpers.sql:14]). Inside a `search_path = ''` definer its `=` operator does not resolve, and the comparison silently falls back to case-sensitive `text = text`. Probe output on the local DB (rolled back): `citext col = text literal, empty search_path:|0`. Plain `text` + a lowercase CHECK + `lower(btrim(input))` in the hook is unambiguous.

**Grants / Data API.**
- Default privileges grant every new `public` table to `authenticated, service_role`, and revoke from anon. Quoted: `alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;` [VERIFIED: 20260912031029_app_membership_lookup_and_grants.sql:30-31, plus `pg_default_acl` on the live DB].
- RLS with zero policies is what blocks `authenticated`, the same as `platform_admins`, whose comment says "Adding a policy for `authenticated` to this table is always a bug". [VERIFIED: platform-admins.ts:5-12]
- In the custom migration also add `revoke all on table public.email_allowlist from anon, authenticated;` as belt and braces. Keep the `service_role` grant for the API pre-check.
- The Data API only exposes `data_api_closed`, so PostgREST cannot reach the table or the functions anyway. [VERIFIED: 20261009111139_data_api_closed_schema.sql]
- Do not add a policy `to supabase_auth_admin`. That would break the zero-policy pin, and the definer makes it unnecessary.

**Hook functions (custom migration `pnpm db:generate --custom --name=email_allowlist_hooks`).**
- `public` schema, `language plpgsql stable security definer set search_path = ''`, owner `postgres`. That is the owner of every existing definer, e.g. `handle_new_user|postgres|t|{"search_path=\"\""}` [VERIFIED: live pg_proc].
- `revoke all on function ... from public, anon, authenticated, service_role;` then `grant execute ... to supabase_auth_admin;` and `grant usage on schema public to supabase_auth_admin;`. Usage is already true locally; the docs say hosted has no usage by default, and the grant is idempotent.
- The default ACL gives `anon`/`authenticated` EXECUTE on new public functions (`postgres|public|f|{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` [VERIFIED: live pg_default_acl]), so the explicit revoke is mandatory.
- Prototype probed (rolled back) under `set local role supabase_auth_admin`:
  - `ok|{"claims": {"sub": "s", "email": " OK@X.local"}}`
  - `blocked|{"error": {"message": "EMAIL_NOT_ALLOWED", "http_code": 403}}`
  - direct `select count(*) from public.probe_email_allowlist` → `permission denied`
  - `has_function_privilege('anon'|'authenticated')` → `f`

Skeleton (validated shape):
```sql
create or replace function public.hook_custom_access_token_allowlist(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user  uuid := nullif(event->>'user_id', '')::uuid;
  v_email text := lower(btrim(coalesce(event->'claims'->>'email', '')));
begin
  -- super_admin first: a bad list can never lock the platform owner out
  if v_user is not null and exists (select 1 from public.platform_admins pa where pa.user_id = v_user) then
    return jsonb_build_object('claims', event->'claims');
  end if;
  if v_email <> '' and exists (select 1 from public.email_allowlist a
                                where a.email = v_email and a.status = 'liberado') then
    return jsonb_build_object('claims', event->'claims');
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'EMAIL_NOT_ALLOWED'));
end $$;
-- before_user_created: same body keyed on lower(btrim(event->'user'->>'email')), allow = '{}'::jsonb, no super_admin branch
```

**pgTAP.**
- Files live in `supabase/tests/NNN-*.sql`, run by `pnpm supabase test db` in name order. Each file is `begin; select plan(n); ... select * from finish(); rollback;`. Fixture ids use a file-unique prefix. Helpers: `tests.auth_user`, `tests.tenant`, `tests.member` (000-helpers.sql). Style reference: 170-membership-email-unconfirmed.sql.
- Next free number: `198-email-allowlist.sql`.
- Assert:
  - (a) `prosecdef` and `'search_path=""' = any(proconfig)` (the 196/197 style).
  - (b) EXECUTE false for anon/authenticated/service_role and true for `supabase_auth_admin`.
  - (c) RLS on and policy count 0.
  - (d) uppercase/space e-mail insert and a bad status both throw `23514`.
  - (e) behaviour: liberado → `claims` equal to the input; bloqueado, absent and empty e-mail → `{error:{http_code:403,message:'EMAIL_NOT_ALLOWED'}}`; mixed case and whitespace in the input match; super_admin with no row passes; the before hook returns `'{}'` vs the error.
- Also add `('email_allowlist')` to the table-presence list in `010-rls-coverage.sql` assertion 4.
- **pgTAP cannot assume `supabase_auth_admin`.** `postgres` gets `ERROR: permission denied to set role "supabase_auth_admin"` [VERIFIED: probe]. Prove privileges with `has_function_privilege`, and prove the real call path with an integration test against GoTrue.

### 3. Seed and test blast radius

Direct `insert into auth.users` (`supabase/tests/000-helpers.sql:27` `tests.auth_user`, `scripts/rehearsal/*.sql`) **fires no GoTrue hook**. Hooks are invoked from GoTrue HTTP handlers only (hooks.go, `triggerBeforeUserCreated` callers listed above). pgTAP is unaffected except by the new file. [VERIFIED: source]

| Who | Count | Hit by `before_user_created` | Hit by `custom_access_token` | Minimum change |
|---|---|---|---|---|
| `scripts/seed.ts` `ensureUser()` (`seed.ts:1348`, single choke point; callers 1539, 1811, 2419 incl. `SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test'` at :72) | 1 helper | no (`admin.createUser`) | yes, every seed login (integration 214 `signInAs`/`signInWithPassword` calls in ~54 files, reuse-fixture `session.ts`, e2e password grants) | Upsert `(lower(email),'liberado')` inside `ensureUser` via `withAdminTx`. That covers all seed users. |
| API integration: `createSharedIdentity` (`setup.ts:77`) + 20 direct `authAdmin().createUser` sites (auth-middleware, stories-author-photo, members, moderation-log, platform-domains, events, notifications×2, bootstrap, send-email-hook, confirm-existing-emails, chat, platform-tenants×2, modules, feed-edit-delete, invites×2, isolation, member-admin) | 21 | no | yes, when they later sign in | Add `allowEmail(email, status='liberado')` to `setup.ts` (uses the existing `adminSql`), call it inside `createSharedIdentity`, add one line before each direct site. Extend `removeIdentitiesByPrefix` to `delete from public.email_allowlist where email like prefix-%`. |
| API integration via `POST /v1/public/signup` (signup.test.ts, admin-rules.test.ts, member-admin.test.ts) | 3 files | n/a: the new **API pre-check** rejects | yes | `allowEmail` before each signup |
| API integration invites (`inviteUserByEmail`, `generateLink type:'invite'`) in invites.test.ts, platform-tenants.test.ts | 2 files | **yes** | yes (verifyOtp) | `allowEmail` for the invited address |
| e2e `POST /auth/v1/admin/users` helpers: admin.ts:75, feed-admin.ts:39, events-admin.ts:41, members-admin.ts:52, courses-admin.ts:56 | 5 helpers | no | yes | One shared `allowEmail` in e2e (`tenant-fixtures.ts` already opens `postgres` with `PLAYWRIGHT_DB_URL ?? postgres://postgres:postgres@127.0.0.1:54322/postgres`), called in each helper |
| e2e UI sign-ups: signup.spec.ts (12 `/cadastro` visits), multi-tenant-identity.spec.ts (3), admin-rules.spec.ts, phase8-smoke.spec.ts, auth-pages.spec.ts | 5 specs | API pre-check | yes | `allowEmail` before the form submit |
| e2e invites: invite.spec.ts, platform-tenants.spec.ts, platform-wizard.spec.ts | 3 specs | **yes** | yes | `allowEmail` for the admin e-mail |

Throwaway e-mails span about 17 domains (`@rede-demo.local` ×329, `@rede-lab.local` ×75, `@e2e.local`, `@invite.test`, ...). A domain/TLD exemption in the hook would be a production bypass and contradicts "everyone else must be listed", so **reject it**. Rejected alternative: a test-harness-only `after insert on auth.users` trigger that auto-allows. It needs zero per-site edits, but it lives outside migrations, survives in the dev DB between `db reset`s and masks the behaviour locally. Run order stays `pnpm db:reset && pnpm db:seed`, then the suites (user memory: "reset needs seed").

### 4. Error mapping changes

**Contracts / API.**
- Add `'EMAIL_NOT_ALLOWED'` to `ERROR_CODES` (`packages/contracts/src/errors.ts:15-44`; today's list ends `'NOT_FOUND', 'CONFLICT', 'NOT_IMPLEMENTED', 'INTERNAL'`) [VERIFIED: read].
- Add `EMAIL_NOT_ALLOWED: 'Seu acesso ainda não foi liberado.'` to `ERROR_MESSAGES` (`packages/core/server/http/api-error.ts:6-27`; `Record<ErrorCode,string>`, so typecheck forces it).
- Export the sentinel, e.g. `export const ALLOWLIST_REJECTION = 'EMAIL_NOT_ALLOWED'`, plus a helper `isAllowlistRejection(err: {status?: number; message?: string})`.

**`packages/core/server/tenancy/signup.ts`.** Insert the pre-check after the consent check (:192-197) and **before** `createUser` (:200): a `withAdminTx` select on `email_allowlist` where `email = lower(btrim(body.email))` and `status = 'liberado'`; if missing, `throw new ApiError(403, 'EMAIL_NOT_ALLOWED')`. It runs before the duplicate path on purpose: an existing-but-unlisted identity cannot log in anyway, so it should get "não liberado" rather than the "já tem conta" state. Also add an `isAllowlistRejection(created.error)` branch next to `isDuplicateEmail` for future-proofing.

**`packages/core/server/platform/invites.ts`.** At :487-512 the error is currently mapped to `revertClaim` + 500 `INTERNAL`, and at :790/:839 to 500. Add an `isAllowlistRejection` branch → `ApiError(403, 'EMAIL_NOT_ALLOWED')` (keep `revertClaim`). Recommended in addition: a pre-check in `createTenant` (`platform/tenants.ts:207-213`, beside the `identityKind` refusal) → `ApiError(400, 'VALIDATION_FAILED', { adminEmail: 'not_allowed' })`. The wizard then shows a field error. Without it, the invite send runs after commit, or later from the pg-boss job `invite-send.ts:197`, so the super_admin only sees a failed send. The existing-identity invite path (no GoTrue create) is caught at login/verifyOtp.

**Web.**
- `apps/web/app/(auth)/entrar/actions.ts:34-43`: after `isEmailNotConfirmed`, `if (isAllowlistRejection(error)) redirect('/entrar?erro=nao-liberado')`. In `entrar/page.tsx:152` add an `erro === 'nao-liberado'` alert. Catalog `messages/pt-BR/login.json` today has `"invalid": "Email ou senha incorretos."` [VERIFIED]; add `"notAllowed": "Seu acesso ainda não foi liberado."`.
- `apps/web/app/(auth)/cadastro/[slug]/actions.ts`:
  - `signup` (:84-93): parse the envelope on 403 with `code === 'EMAIL_NOT_ALLOWED'` → `${base}?erro=nao-liberado`. Place it before the generic `!res.ok`.
  - `joinFromSignup` (:158-169): `isAllowlistRejection(error)` → `${state}&erro=nao-liberado`. Today it falls into `erro=senha` ("Senha incorreta"), which is wrong.
  - Page `cadastro/[slug]/page.tsx:114-128`: add the branch. Catalog `signup.json`: add `notAllowed`.
- `apps/web/app/auth/confirm/route.ts:79-89`: when `verifyOtp` errors with the sentinel, redirect to `/entrar?erro=nao-liberado` **before** the invite (`/convite-expirado`) and signup fallbacks. The token is not consumed (tx rollback), so the same mail link works after listing. Add a case to `route.test.ts`.
- Refresh: `proxy.ts` `getClaims()` refreshes. A non-retryable `AuthApiError` makes auth-js drop the session, and the user lands on `/entrar` without a message. [ASSUMED: @supabase/ssr session-removal behaviour on a 403 refresh; not probed]. This is acceptable per the locked decision; the next login shows the message.

### 5. Pitfalls

1. **A broken `custom_access_token` locks out everyone, super_admin included.** Keep the body trivial: PK lookups only, no casts that can throw beyond `nullif(...)::uuid` on a GoTrue-supplied uuid, and no `?` operator (the docs warn about it in the SQL editor). Put the super_admin branch first. Prove it with pgTAP **and** with one integration test against real GoTrue (sign-in allowed, rejected, refresh rejected after flipping to `bloqueado`, super_admin with no row). Never ship the config enable before the migration has created the functions: GoTrue would answer 500 on every login.
2. **Claims must pass through unchanged.** Return `event->'claims'` exactly. Never `return event` minus keys, and never build claims by hand.
3. **4xx only.** `http_code` 403. A 5xx is retried by supabase-js and logged as `unexpected_failure`.
4. **2 s statement timeout** inside GoTrue's tx. Two PK lookups are far below it.
5. **citext + empty search_path is case-sensitive** (probed). Use text + a lowercase CHECK.
6. **`before_user_created` ≠ all creation paths.** `admin.createUser` skips it, so the API pre-check is mandatory. The token hook remains the backstop for any future `admin.createUser` caller.
7. **New super_admin accounts:** they are created with `admin.createUser`, which no hook blocks, and are exempt at login. CONTEXT's worry ("must have its e-mail on the list") does not materialise.
8. **Remote inherits base.** Enabling locally also enables production on the next `config push` (deploy-api.yml:123 `db push` runs before :137 `config push`, so the functions exist first).
9. **The hml project**, if its config is pushed, gets the hooks too, with the same pg-functions URIs. It needs the same migration and list.

### Rollout (for the plan's production notes)
deploy-api.yml applies `supabase db push --include-roles` (:123) and then `supabase config push` (:137) in one job, so the hooks go live minutes after the table exists, and the table is empty. There are two options:
- **(a)** Accept it. super_admin is exempt and nobody else uses the platform. Igor inserts rows right after the deploy:
  `insert into public.email_allowlist (email,status) values (lower('x@y'),'liberado') on conflict (email) do update set status = excluded.status, updated_at = now();`
- **(b)** Two-step. Ship `[remotes.production.auth.hook.*] enabled = false` first, populate, then flip to `true` and push again.

**Recommend (b)** if any tenant admin must keep logging in during the deploy, otherwise (a). The plan must document both and the SQL Editor upsert.

## Environment Availability

| Dependency | Available | Version | Note |
|---|---|---|---|
| Local Supabase stack | ✓ (running) | Postgres 17.6, GoTrue v2.197.0 | hook edits need `pnpm supabase stop && pnpm supabase start` |
| Supabase CLI (pinned) | ✓ | 2.117.0 (global 2.118.0; always use `pnpm supabase` / `scripts/supabase.sh`) | hook keys supported |
| Direct login as `supabase_auth_admin` (local) | ✓ | password `postgres` | handy for manual probing only, not for pgTAP |

## Validation Architecture

| Property | Value |
|---|---|
| Frameworks | pgTAP via `pnpm supabase test db`; Vitest 5 (api integration, web unit) |
| Quick run | `pnpm supabase test db` (all files, fast); `cd apps/api && pnpm exec vitest run tests/integration/email-allowlist.test.ts` (memory: `test:integration -- x` does not filter); `pnpm --filter @rede-social/web exec vitest run app/auth/confirm/route.test.ts` |
| Full gate | `pnpm db:reset && pnpm db:seed && pnpm supabase test db && pnpm test:integration` (pgTAP before integration, per memory), then the targeted e2e specs that sign up or invite |

| Behaviour | Test | File |
|---|---|---|
| Table shape, RLS 0 policies, CHECKs, definer/search_path/EXECUTE grants, hook outputs (liberado/bloqueado/absent/case/super_admin) | pgTAP | `supabase/tests/198-email-allowlist.sql` (new); `010` presence list |
| Real GoTrue: unlisted sign-in → `AuthApiError` 403 `EMAIL_NOT_ALLOWED`; listed → ok; `bloqueado` → `refreshSession` 403; super_admin no row → ok; `inviteUserByEmail` unlisted → 403; `/v1/public/signup` unlisted → 403 `EMAIL_NOT_ALLOWED`; `verifyOtp` on a `generateLink` recovery hash rejected, then accepted after listing (proves rollback) | Vitest integration | `apps/api/tests/integration/email-allowlist.test.ts` (new) |
| Web maps the sentinel (login, join, confirm) | Vitest unit | `apps/web/app/auth/confirm/route.test.ts` + action tests if present |

Wave 0 work: the `allowEmail` helpers (api `setup.ts`, e2e shared) and the seed `ensureUser` upsert must land **before** the config enable. Otherwise the existing suites go red.

## Security Domain

| ASVS | Applies | Control |
|---|---|---|
| V2 Authentication | yes | Token issuance gated by the DB hook; login order keeps the password check before the allowlist answer |
| V4 Access Control | yes | RLS on with 0 policies; definer EXECUTE only for `supabase_auth_admin`; Data API closed |
| V5 Input Validation | yes | CHECK `email = lower(btrim(email))`, status CHECK; hook normalises its input |

Threats:
- Allowlist enumeration via `/cadastro`: accepted by the user. Keep the existing attributable `log.warn` style for `signup.not_allowed`.
- Hook bypass through `admin.createUser`: closed by the API pre-check plus the token hook.
- Lock-out (DoS) through a hook bug: mitigated by the super_admin branch first, pgTAP and the integration test.
- Privilege abuse of the definer: mitigated by revoking from public/anon/authenticated/service_role, by `search_path=''` and by fully qualified names.

## Assumptions Log

| # | Claim | Risk if wrong |
|---|---|---|
| A1 | @supabase/ssr drops the session cookies when a refresh answers 403 (user ends on `/entrar` without a message) | Blocked user might see a broken page instead of the login screen until the cookies expire; covered by the integration refresh test at the API level only |
| A2 | Hosted GoTrue (newer than v2.197.0) keeps the same hook call sites and error serialisation | Checked on `master` for `admin.go` only; re-verify by the post-deploy smoke login |
| A3 | Hosted `postgres` keeps BYPASSRLS as function owner (repo-wide assumption already, CLAUDE.md) | The definer would read zero rows from both RLS tables, so every login, super_admin included, would be refused. Smoke-test the super_admin login right after enabling; option (b) of Rollout makes this reversible by flipping `enabled = false` |

## Sources
- GoTrue v2.197.0 source via `gh api repos/supabase/auth/contents/...?ref=v2.197.0`: `internal/api/{admin,invite,mail,signup,verify,token,errors}.go`, `internal/api/apierrors/{apierrors,errorcode}.go`, `internal/hooks/{hookserrors,hookspgfunc,v0hooks}`, `internal/tokens/service.go` (HIGH)
- https://supabase.com/docs/guides/auth/auth-hooks, .../before-user-created-hook, .../custom-access-token-hook (HIGH/MEDIUM: the docs are silent on admin-path coverage and on the client error shape; the source fills that gap)
- `@supabase/auth-js@2.116.0` `dist/main/lib/fetch.js` (installed in repo) (HIGH)
- Live local DB probes (rolled back): roles, default ACLs, citext operator resolution, hook prototype under `supabase_auth_admin` (HIGH)

**Valid until:** 2026-11-17 (re-check GoTrue `admin.go` if the Supabase image is bumped).
