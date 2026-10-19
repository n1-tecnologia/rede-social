# Quick Task 261018-owq: Allowlist global de e-mails para cadastro e login - Context

**Gathered:** 2026-10-18
**Status:** Ready for planning

<domain>
## Task Boundary

Only e-mails present in a new global allowlist table with status `liberado` can create an account or sign in to the platform. Two enforcement points: account creation and token issuance (login + refresh). The list is maintained manually in the database (Supabase SQL Editor) for now.

In scope:
- New global table (no `tenant_id`): `email` (stored lowercase, unique) + `status` (`liberado` | `bloqueado`), timestamps as per project convention.
- RLS enabled with no policies for `anon` / `authenticated` (only the auth hooks and service paths read it).
- Supabase Auth hook `before_user_created`: rejects user creation unless the e-mail is `liberado`. Covers `packages/core/server/platform/invites.ts` (`inviteUserByEmail`), generateLink signup/invite and OAuth/SSO. **Correction from research:** GoTrue does NOT run this hook for `auth.admin.createUser`, so `packages/core/server/tenancy/signup.ts` (`signupMember`, line ~200) needs an explicit API-side allowlist check before `createUser` (403 `EMAIL_NOT_ALLOWED`).
- Supabase Auth hook `custom_access_token` (not enabled in the project yet): rejects token issuance unless the e-mail is `liberado`. Covers `signInWithPassword` (`apps/web/app/(auth)/entrar/actions.ts`), `verifyOtp` (`apps/web/app/auth/confirm/route.ts`), the "já tem conta" form on `/cadastro/[slug]`, and refresh.
- Enable both hooks in `supabase/config.toml` locally and under `[remotes.production]`.
- Friendly pt-BR error messages on signup and login screens.
- pgTAP tests.

Out of scope: management UI for the list, immediate-revocation check in the API auth middleware, a `pendente` status, per-tenant lists.

</domain>

<decisions>
## Implementation Decisions

### List scope
- Global — one list for the whole platform, no `tenant_id`.

### List maintenance
- Populated manually via SQL by Igor. No admin UI, no API endpoint.

### Existing accounts
- Nobody is actually using the platform yet; no backfill migration. Igor adds any existing user's e-mail by hand afterwards.

### Exemptions
- `super_admin` (rows in `platform_admins`) is exempt from the login check.
- Everyone else must be listed, including tenant admins invited via platform invites and buyers coming from store flows.
- At creation time the role is not known yet; a new super_admin account must have its e-mail on the list (or be created before the hook is enabled).

### Status values
- Only `liberado` and `bloqueado`. Absent e-mail behaves like blocked.
- Blocking takes effect on the next token issuance/refresh (≤ access-token TTL, ~1 h). Accepted.

### E-mail matching
- Case-insensitive (normalize to lowercase on write and compare lowercase/trimmed).

### UX messages
- pt-BR, e.g. "Seu acesso ainda não foi liberado." on both signup and login, instead of a generic error. Accepted that signup reveals whether an e-mail is on the list.

### Rollout
- Push and production deploy (migration + enabling hooks on the hosted project) are done by Igor. Plan must document the production steps and the "populate the list before enabling hooks" ordering.
- **Decided (2026-10-18): ship disabled in production.** Under `[remotes.production]` both new hooks are explicitly `enabled = false` (remote config inherits base values, so the override is mandatory). Locally they are enabled. Igor populates the list via SQL Editor, then flips production to `enabled = true` and runs `config push`. Document this two-step runbook in the SUMMARY.

### Claude's Discretion
- Seed and tests: local hooks will block seed users and every test that creates users. Recommended approach: seed inserts all seed e-mails as `liberado`, and shared test helpers that create users insert the e-mail into the allowlist first. Keep the hooks enabled locally so the behavior is tested. Planner/researcher should size how many helpers/suites create users.
- Exact table/function names, enum vs check constraint, hook error codes/messages mapping, and how the web layer detects the hook rejection.
- Whether to also check the allowlist in `createTenant` (platform wizard field error) — research recommends it; planner decides.
- Whether the hook functions must be `security definer` / grants to `supabase_auth_admin` (follow Supabase hook docs).

</decisions>

<specifics>
## Specific Ideas

- Public GoTrue signup is already closed (`[auth] enable_signup = false`, `supabase/config.toml:239`), so creation only happens through the API's admin calls.
- `send_email` hook is already configured as HTTP in config.toml (local + `[remotes.production.auth.hook.send_email]`); follow that pattern for the new hooks' production config.
- Super admins live in `platform_admins` (`packages/core/db/schema/platform-admins.ts`).
- A failing `custom_access_token` hook blocks ALL logins: the function must be defensive and pgTAP-tested.

</specifics>

<canonical_refs>
## Canonical References

- https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook
- https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook (required claims must be preserved; error return shape)
- Project parallelism note: another session is running `/gsd-plan-phase 08.7` (writes only `.planning/phases/08.7-*`). Commits from this quick must be path-scoped and must not touch 08.7 files. Local `supabase db reset` is allowed.

</canonical_refs>
