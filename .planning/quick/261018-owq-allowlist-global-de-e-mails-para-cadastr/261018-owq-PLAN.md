---
phase: quick-261018-owq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  # Task 1 (tracer: token issuance end to end)
  - packages/core/db/schema/email-allowlist.ts
  - packages/core/db/schema/index.ts
  - supabase/migrations/*_email_allowlist.sql
  - supabase/migrations/*_email_allowlist_hooks.sql
  - supabase/migrations/meta/_journal.json
  - supabase/migrations/meta/*_snapshot.json
  - supabase/config.toml
  - supabase/tests/175-email-allowlist.sql
  - supabase/tests/010-rls-coverage.sql
  - scripts/seed.ts
  - packages/contracts/src/allowlist.ts
  - packages/contracts/src/index.ts
  - packages/contracts/tests/allowlist.test.ts
  - apps/api/tests/integration/setup.ts
  - apps/api/tests/integration/email-allowlist.test.ts
  - apps/web/app/(auth)/entrar/actions.ts
  - apps/web/app/(auth)/entrar/page.tsx
  - apps/web/messages/pt-BR/login.json
  - apps/web/e2e/admin.ts
  - apps/web/e2e/login.spec.ts
  # Task 2 (account creation in the API)
  - packages/contracts/src/errors.ts
  - packages/core/server/http/api-error.ts
  - packages/core/server/tenancy/email-allowlist.ts
  - packages/core/server/tenancy/signup.ts
  - packages/core/server/platform/tenants.ts
  - packages/core/server/platform/invites.ts
  - packages/core/server/platform/invite-send.ts
  - packages/core/tests/invite-send.test.ts
  - apps/api/src/routes/public.ts
  - apps/api/tests/integration/signup.test.ts
  - apps/api/tests/integration/admin-rules.test.ts
  - apps/api/tests/integration/member-admin.test.ts
  - apps/api/tests/integration/invites.test.ts
  - apps/api/tests/integration/platform-tenants.test.ts
  - apps/api/tests/integration/platform-domains.test.ts
  - apps/api/tests/integration/platform-branding.test.ts
  # Task 3 (web creation screens + e2e harness)
  - apps/web/app/(auth)/cadastro/[slug]/actions.ts
  - apps/web/app/(auth)/cadastro/[slug]/page.tsx
  - apps/web/messages/pt-BR/signup.json
  - apps/web/app/auth/confirm/route.ts
  - apps/web/app/auth/confirm/route.test.ts
  - apps/web/app/(platform)/plataforma/novo/actions.ts
  - apps/web/messages/pt-BR/platform.json
  - apps/web/e2e/feed-admin.ts
  - apps/web/e2e/events-admin.ts
  - apps/web/e2e/members-admin.ts
  - apps/web/e2e/courses-admin.ts
  - apps/web/e2e/wizard.ts
  - apps/web/e2e/signup.spec.ts
  - apps/web/e2e/multi-tenant-identity.spec.ts
  - apps/web/e2e/admin-rules.spec.ts
  - apps/web/e2e/phase8-smoke.spec.ts
  - apps/web/e2e/auth-pages.spec.ts
  - apps/web/e2e/invite.spec.ts
  - apps/web/e2e/platform-tenants.spec.ts
  - apps/web/e2e/platform-domains.spec.ts
  - apps/web/e2e/platform.spec.ts
autonomous: true
requirements: [AUTH-01, AUTH-02, ROLE-03]
tags: [security, auth, supabase, auth-hooks, gotrue, allowlist, migration, rls, pgtap, config, e2e, quick]

estimate:
  tokens: 300000
  raw_tokens: 300000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "On the local stack, GoTrue refuses a token for an identity whose e-mail is absent from public.email_allowlist or is `bloqueado`: password sign-in, refresh and verifyOtp each fail with HTTP 403 and the exact message EMAIL_NOT_ALLOWED (status 4xx, never 5xx). A `liberado` e-mail signs in whatever its case or surrounding spaces, its token carries the unchanged required claims and the API accepts it. A user in public.platform_admins with no list row still signs in (CONTEXT: super_admin exempt)."
    - "A rejected verifyOtp is rolled back by GoTrue: the same recovery token hash that was refused for an unlisted e-mail succeeds once the e-mail is listed (proved in email-allowlist.test.ts)."
    - "No account can be created for an unlisted e-mail on any path: POST /v1/public/signup answers 403 EMAIL_NOT_ALLOWED with the pt-BR message 'Seu acesso ainda não foi liberado.' and leaves no auth.users row (an existing unlisted identity also gets 403, not 409); GoTrue inviteUserByEmail and generateLink (signup, invite) answer 403 EMAIL_NOT_ALLOWED and create nothing; POST /v1/platform/tenants answers 400 VALIDATION_FAILED { adminEmail: 'not_allowed' } and creates no tenant; an invite send or resend for an address un-listed after tenant creation answers 403 EMAIL_NOT_ALLOWED, leaves the invite pending and is terminal for the pg-boss job."
    - "The screens say 'Seu acesso ainda não foi liberado.': /entrar after a login or a mail link (signup, recovery, invite) refused by the hook, /cadastro/[slug] after a refused sign-up and on the 'já tem conta' form; the platform wizard shows a field error under the first-admin e-mail. Every string lives in the next-intl pt-BR catalog."
    - "public.email_allowlist (global, no tenant_id) has RLS on with zero policies and no privilege for anon/authenticated; the two hook functions are SECURITY DEFINER with an empty search_path, executable only by supabase_auth_admin; e-mails are stored lowercase and trimmed (CHECK) and statuses are only liberado | bloqueado (CHECK). pgTAP 175 pins every one of these facts and the exact rejection envelope."
    - "supabase/config.toml enables both hooks locally (auth container env shows both *_ENABLED=true) and declares both under [remotes.production] with enabled = false (locked rollout decision); the SUMMARY carries the two-step production runbook (db push, populate the list in SQL Editor, flip enabled = true, config push) and the rollback."
    - "Seed users and every test-harness identity are listed, so on a fresh pnpm db:reset + pnpm db:seed the whole pgTAP suite, the whole pnpm test:integration and the affected e2e specs pass with the hooks enabled."
  artifacts:
    - path: "packages/core/db/schema/email-allowlist.ts"
      provides: "Drizzle table email_allowlist: email text PK, status text default liberado, created_at/updated_at, two CHECKs, enableRLS with no policy"
      contains: "email_allowlist_email_lower_chk"
    - path: "supabase/migrations/*_email_allowlist_hooks.sql"
      provides: "Custom migration: table revokes, public.hook_custom_access_token_allowlist(jsonb) and public.hook_before_user_created_allowlist(jsonb) as SECURITY DEFINER, EXECUTE only for supabase_auth_admin"
      contains: "hook_custom_access_token_allowlist"
    - path: "supabase/config.toml"
      provides: "[auth.hook.before_user_created] and [auth.hook.custom_access_token] enabled locally; [remotes.production.auth.hook.*] for both with enabled = false"
      contains: "pg-functions://postgres/public/hook_custom_access_token_allowlist"
    - path: "supabase/tests/175-email-allowlist.sql"
      provides: "pgTAP: shape, CHECKs, RLS/policies, privileges, definer facts, owner facts, hook behaviour matrix"
      contains: "EMAIL_NOT_ALLOWED"
    - path: "packages/contracts/src/allowlist.ts"
      provides: "ALLOWLIST_REJECTION_MESSAGE sentinel and isAllowlistRejection(error) shared by API and web"
      contains: "isAllowlistRejection"
    - path: "packages/core/server/tenancy/email-allowlist.ts"
      provides: "isEmailAllowed(tx, email) with SQL-side lower(btrim()) normalisation, used by signupMember and createTenant"
      contains: "isEmailAllowed"
    - path: "apps/api/tests/integration/email-allowlist.test.ts"
      provides: "Real-GoTrue proof of both hooks and the API pre-checks"
      contains: "refreshSession"
    - path: "apps/api/tests/integration/setup.ts"
      provides: "allowEmail / disallowEmail helpers; authAdmin().createUser lists the fixture e-mail first; removeIdentitiesByPrefix clears list rows"
      contains: "allowEmail"
    - path: "apps/web/e2e/admin.ts"
      provides: "allowEmail / disallowEmail for every e2e helper; createMember lists its e-mail"
      contains: "allowEmail"
  key_links:
    - from: "supabase/config.toml hook uri"
      to: "function names created by *_email_allowlist_hooks.sql"
      via: "pg-functions://postgres/public/<fn>; the auth container reads it at pnpm supabase stop + start"
      pattern: "pg-functions://postgres/public/hook_"
    - from: "packages/contracts/src/allowlist.ts ALLOWLIST_REJECTION_MESSAGE"
      to: "the SQL literal returned by both hook functions"
      via: "pgTAP 175 pins the SQL literal; email-allowlist.test.ts imports the contract constant and compares it with GoTrue's real error"
      pattern: "EMAIL_NOT_ALLOWED"
    - from: "packages/core/server/tenancy/signup.ts signupMember"
      to: "public.email_allowlist"
      via: "isEmailAllowed inside withAdminTx BEFORE supabaseAdmin.auth.admin.createUser (GoTrue's admin create never fires before_user_created)"
      pattern: "isEmailAllowed"
    - from: "apps/web/app/(auth)/entrar/actions.ts"
      to: "GoTrue hook rejection"
      via: "isAllowlistRejection(error) -> redirect('/entrar?erro=nao-liberado')"
      pattern: "nao-liberado"
    - from: "scripts/seed.ts ensureUser"
      to: "public.email_allowlist"
      via: "upsert (lower(btrim(email)), 'liberado') for every seed identity"
      pattern: "emailAllowlist"
---

<objective>
Only e-mails listed as `liberado` in a new global table `public.email_allowlist` can create an account or receive a token on the platform. Enforcement has three layers (RESEARCH primary recommendation):

1. A Supabase Auth `custom_access_token` hook refuses token issuance for every grant: password, verifyOtp (signup, recovery, invite links) and refresh. `super_admin` (rows in `public.platform_admins`) is exempt.
2. A Supabase Auth `before_user_created` hook refuses GoTrue's own creation paths: `inviteUserByEmail`, `generateLink` signup/invite, and any OAuth/SSO path.
3. API pre-checks, because GoTrue's `auth.admin.createUser` never fires `before_user_created` (RESEARCH correction to CONTEXT). One sits in `signupMember` (403 `EMAIL_NOT_ALLOWED`). The other sits in `createTenant` and gives a wizard field error (planner's choice on that discretion item).

The list is kept by hand in the SQL Editor. There is no UI and no endpoint. The screens show "Seu acesso ainda não foi liberado." in pt-BR. Both hooks are enabled locally and explicitly disabled under `[remotes.production]`, which is the locked rollout decision. Igor pushes, populates the list and flips production. The executor never runs `db push` or `config push`.

Purpose: a white-label pilot that is closed to invited people only, without a management UI, and with no way around it through any GoTrue endpoint.

Output:
- the table plus a custom hook migration;
- the config blocks;
- pgTAP 175;
- the real-GoTrue integration suite `email-allowlist.test.ts`;
- the API pre-checks and error mapping;
- the web messages;
- seed and test-harness listing, so every suite stays green with the hooks on;
- a SUMMARY with the production runbook.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@.planning/quick/261018-owq-allowlist-global-de-e-mails-para-cadastr/261018-owq-CONTEXT.md
@.planning/quick/261018-owq-allowlist-global-de-e-mails-para-cadastr/261018-owq-RESEARCH.md
@packages/core/db/schema/platform-admins.ts
@packages/core/db/schema/tenant-invites.ts
@supabase/migrations/20261006215630_identity_has_password.sql
@supabase/tests/170-membership-email-unconfirmed.sql
@apps/api/tests/integration/setup.ts

Locked decisions (CONTEXT.md, do not revisit):
- The list is global, with no tenant_id.
- It is maintained by hand in SQL, with no UI or endpoint.
- There is no backfill.
- super_admin is exempt at login.
- Statuses are only `liberado` and `bloqueado`; an absent row means blocked. Blocking takes effect on the next token issuance or refresh, within about 1 h.
- Matching is case-insensitive and trimmed.
- The pt-BR message "Seu acesso ainda não foi liberado." appears on signup and login. Enumeration through signup is accepted.
- Production ships both hooks with `enabled = false`. Igor populates the list, flips the flag and pushes.

Out of scope (CONTEXT "Out of scope" / deferred):
- a management UI for the list;
- an immediate-revocation check in the API auth middleware;
- a `pendente` status;
- per-tenant lists.

Planner choices on CONTEXT "Claude's Discretion":
- Table `public.email_allowlist` uses text plus CHECK constraints, with no enum and no case-insensitive extension type. That extension's operator does not resolve under an empty search_path (RESEARCH, probed).
- Hook functions are `public.hook_custom_access_token_allowlist(jsonb)` and `public.hook_before_user_created_allowlist(jsonb)`. Both are SECURITY DEFINER owned by postgres with `search_path = ''`, and EXECUTE goes only to `supabase_auth_admin`.
- The rejection envelope is `{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}`. The web and the API detect it with `status === 403 && message === 'EMAIL_NOT_ALLOWED'`, and the sentinel lives in `@rede-social/contracts`.
- `createTenant` also pre-checks and returns a wizard field error `adminEmail: 'not_allowed'`.
- The seed lists every seed identity. The integration harness lists every `authAdmin().createUser` e-mail through one wrapper in setup.ts. The e2e harness lists e-mails in `createMember` and in the four other identity helpers. The hooks stay enabled locally, so the real behaviour is what the suites exercise.
- The pgTAP file number is 175, because 198/199 are taken by the 08.7 plans.

Repo rules the executor must keep:
- Drizzle TS is the schema source. Generate with `pnpm db:generate --name=...`. Hand SQL goes in `pnpm db:generate --custom --name=...`, which is journaled.
- Only the Supabase CLI applies migrations. Never run drizzle-kit migrate or push.
- `withAdminTx` is kernel-only.
- Every setting is LOCAL, and the hook functions never `set role`.
- pt-BR strings live only in `apps/web/messages/pt-BR/*.json` (`scripts/check-ui-literals.sh`).
- Run pgTAP before the integration suite, and always run `pnpm db:seed` after `pnpm db:reset`.
- `pnpm test:integration -- x` does not filter. Use `pnpm --filter @rede-social/api exec vitest run tests/integration/<file>`.
- If a gate fails on disk space and no `next dev` is running, `.turbo/cache` and `apps/web/.next/cache` may be removed. Gates use `TURBO_CACHE=local:r`.

Commit rules (parallel session on 08.7):
- Stage explicit paths only, never `git add -A` or `git add .`.
- Never stage anything under `.planning/phases/08.7-*` and never STATE.md.
- For the generated migration files, list `git status --porcelain supabase/migrations` and add exactly the new or modified entries.
- Commits are authored as igor.vboas and carry no AI co-author trailer, because this is a public repo.
</context>

<tasks>

<task type="tracer">
  <name>Task 1: Tracer, token issuance gated end to end (table + both hooks + local config + seed + login screen)</name>
  <files>packages/core/db/schema/email-allowlist.ts, packages/core/db/schema/index.ts, supabase/migrations/*_email_allowlist.sql, supabase/migrations/*_email_allowlist_hooks.sql, supabase/migrations/meta/_journal.json, supabase/migrations/meta/*_snapshot.json, supabase/config.toml, supabase/tests/175-email-allowlist.sql, supabase/tests/010-rls-coverage.sql, scripts/seed.ts, packages/contracts/src/allowlist.ts, packages/contracts/src/index.ts, packages/contracts/tests/allowlist.test.ts, apps/api/tests/integration/setup.ts, apps/api/tests/integration/email-allowlist.test.ts, apps/web/app/(auth)/entrar/actions.ts, apps/web/app/(auth)/entrar/page.tsx, apps/web/messages/pt-BR/login.json, apps/web/e2e/admin.ts, apps/web/e2e/login.spec.ts</files>
  <precondition>The local Supabase stack is up: `pnpm supabase status` exits 0 and Docker lists supabase_auth_rede-social.</precondition>
  <reversibility rating="reversible">Expand-only migration (a new table and two new functions). The local hook enable is a config flag. Production stays disabled.</reversibility>
  <action>
**Schema (CONTEXT: global list, statuses, case-insensitive matching).**
- Create `packages/core/db/schema/email-allowlist.ts`. Export `emailAllowlist = pgTable('email_allowlist', ...)` with these columns:
  - `email: text().primaryKey()`;
  - `status: text().notNull().default('liberado')`;
  - `createdAt` and `updatedAt`, both `timestamp(..., { withTimezone: true }).notNull().defaultNow()` (the tenants.ts pattern).
- Add two checks:
  - `check('email_allowlist_status_chk', sql\`${t.status} in ('liberado','bloqueado')\`)`, in the tenant-invites.ts style;
  - `check('email_allowlist_email_lower_chk', sql\`${t.email} = lower(btrim(${t.email}))\`)`.
- Call `.enableRLS()` and add NO pgPolicy.
- Use plain text. Do not use the case-insensitive extension type from citext.ts: RESEARCH probed that its `=` silently becomes case-sensitive inside an empty-search_path definer.
- Write a doc comment in the platform-admins.ts style covering:
  - the table is platform-global, with no tenant_id;
  - zero policies on purpose, so only the auth hooks (definer) and the admin lane (`withAdminTx`) read it;
  - adding a policy for authenticated is always a bug;
  - Igor maintains it by hand in the SQL Editor;
  - an absent row means blocked.
- Export it from `packages/core/db/schema/index.ts`, keeping alphabetical order.

**Migrations.**
- Run `pnpm db:generate --name=email_allowlist` and review the generated SQL: create table, the two checks, enable RLS.
- Then run `pnpm db:generate --custom --name=email_allowlist_hooks` and write the hand SQL with `--> statement-breakpoint` between statements.
- Open the custom migration with a header in the identity_has_password.sql style. It explains:
  - WHY: `auth.admin.createUser` skips `before_user_created`, so the API pre-checks exist; the token hook is the backstop on every grant.
  - HARDENING:
    - SECURITY DEFINER, owner postgres, which is also the table owner, so RLS without FORCE does not filter the definer;
    - an empty search_path and fully qualified names;
    - 4xx only (a 5xx is retried by supabase-js);
    - super_admin branch first, so a list mistake can never lock the platform owner out.
  - RELEASE ORDER:
    - expand-only;
    - production config ships both hooks disabled;
    - the functions must exist before any hook is enabled, or GoTrue answers 500 on every login.
- Statements in the custom migration:
  - (a) `revoke all on table public.email_allowlist from anon, authenticated;`. Keep the default service_role grant for the admin lane.
  - (b) `public.hook_custom_access_token_allowlist(event jsonb) returns jsonb`, `language plpgsql stable security definer set search_path = ''`. Body, following the RESEARCH "Skeleton (validated shape)":
    - `v_user := nullif(event->>'user_id','')::uuid`;
    - `v_email := lower(btrim(coalesce(event->'claims'->>'email','')))`;
    - if `v_user` is in `public.platform_admins`, return `jsonb_build_object('claims', event->'claims')`;
    - else if `v_email <> ''` and a `public.email_allowlist` row has that email and status `liberado`, return the same claims object;
    - else return `jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'EMAIL_NOT_ALLOWED'))`.
    - Return `event->'claims'` exactly as received. Never add, drop or rebuild a claim; GoTrue validates the required set.
    - Do not use the jsonb `?` operator or any cast beyond the uuid one.
  - (c) `public.hook_before_user_created_allowlist(event jsonb) returns jsonb` with the same attributes. It normalises `event->'user'->>'email'`, returns `'{}'::jsonb` when the e-mail is listed `liberado`, and otherwise returns the identical 403 error object. It has no super_admin branch, because the user does not exist yet.
  - (d) For each function: `revoke all on function ... from public, anon, authenticated, service_role;` then `grant execute on function ... to supabase_auth_admin;`. The explicit revoke is mandatory: the default ACL gives anon/authenticated EXECUTE on new public functions.
  - (e) `grant usage on schema public to supabase_auth_admin;`. It is idempotent; hosted lacks it by default.
  - (f) A `comment on function` for each.

**Config (locked rollout decision).**
- In `supabase/config.toml`, replace the two commented templates near line 351-359 with real blocks:
  - `[auth.hook.before_user_created]`: `enabled = true`, `uri = "pg-functions://postgres/public/hook_before_user_created_allowlist"`;
  - `[auth.hook.custom_access_token]`: `enabled = true`, `uri = "pg-functions://postgres/public/hook_custom_access_token_allowlist"`.
- Add comments saying:
  - edits need `pnpm supabase stop && pnpm supabase start`, because they are auth container env;
  - `admin.createUser` is covered by the API pre-check instead;
  - no secrets key is needed for pg-functions hooks.
- Next to the existing `[remotes.production.auth.hook.send_email]`, add `[remotes.production.auth.hook.before_user_created]` and `[remotes.production.auth.hook.custom_access_token]`. Each has `enabled = false` and the same uri.
- Comment there:
  - remote tables inherit base values, so the explicit false is mandatory;
  - Igor flips both to true only after the list is populated (runbook in this quick's SUMMARY);
  - a future `[remotes.homolog]` table must carry the same two disabled blocks.

**[BLOCKING] schema apply, local only.** After the schema, migrations and config are written, and before any verification, run in this order:
1. `pnpm db:reset` (applies every migration and sets the api_user password);
2. `pnpm supabase stop && pnpm supabase start` (the auth container picks up the hook env, with the functions already present);
3. `pnpm db:seed`.
If `supabase start` refuses, do stop, start, `pnpm db:reset`, `pnpm db:seed` instead.
- Never run `supabase db push`, `supabase config push` or `drizzle-kit migrate`.
- Confirm with `docker inspect supabase_auth_rede-social` that both `GOTRUE_HOOK_*_ENABLED=true` lines exist.

**Seed.**
- In `scripts/seed.ts` add `emailAllowlist` to the dynamic schema import.
- At the top of `ensureUser` (line ~1348), before the GoTrue call, upsert through `withAdminTx`:
  - values: email `sql\`lower(btrim(${email}))\``, status `'liberado'`;
  - `onConflictDoUpdate` on email, setting status `'liberado'` and `updatedAt` to now().
- That single choke point lists every seed identity, including the super admin, the removed-member identity and every reuse-fixture login.

**Contracts.**
- Create `packages/contracts/src/allowlist.ts` with:
  - `ALLOWLIST_REJECTION_MESSAGE = 'EMAIL_NOT_ALLOWED' as const`;
  - `ALLOWLIST_REJECTION_STATUS = 403 as const`;
  - `isAllowlistRejection(error: { status?: number; message?: string } | null | undefined): boolean`, true only for status 403 and message exactly equal to the sentinel.
- Add a doc comment: the SQL hooks cannot import this, so pgTAP 175 pins the literal and the integration suite compares this constant with GoTrue's real error.
- Re-export it from `packages/contracts/src/index.ts`.
- Add `packages/contracts/tests/allowlist.test.ts` covering:
  - true for 403 with the sentinel;
  - false for 403 with another message, for 500 with the sentinel, and for null, undefined and a plain Error without status.

**Integration harness** (`apps/api/tests/integration/setup.ts`).
- Export `allowEmail(email, status = 'liberado')`. It upserts `(lower(btrim(email)), status)` with `on conflict (email) do update` setting status and updated_at, through `adminSql`.
- Export `disallowEmail(email)`. It deletes the row matching `lower(btrim(email))`.
- Make `authAdmin()` list fixture identities. Keep the GoTrue admin instance it returns, and assign an own `createUser` property on it that awaits `allowEmail(attributes.email)` when an e-mail is present, then calls the original method bound to the instance. Document why: every harness identity is meant to sign in, and the allowlist suite un-lists explicitly with `disallowEmail`.
- This covers `createSharedIdentity` and the 20 direct `authAdmin().createUser` sites with zero per-site edits.
- Extend `removeIdentitiesByPrefix` to also delete `public.email_allowlist` rows whose email is like `${prefix}-%`.

**Integration suite** (new `apps/api/tests/integration/email-allowlist.test.ts`). Use real GoTrue through a publishable-key supabase-js client built like `signInAs`, with persistSession and autoRefreshToken off. Use throwaway e-mails `owq-<run>-<case>@rede-demo.local`. Clean up with `removeIdentitiesByPrefix('owq')` in beforeAll and afterAll. Cases:
- (1) A listed identity made with `createSharedIdentity` and one seed-host membership:
  - `signInWithPassword` succeeds;
  - the decoded access-token payload still has `sub`, `email`, `role`, `aal`, `session_id` and `is_anonymous`;
  - an authenticated API call the suite already uses with such a token answers 200 (e.g. the route bootstrap.test.ts calls).
- (2) After `disallowEmail`, sign-in fails with `error.status === 403`, `error.message === ALLOWLIST_REJECTION_MESSAGE` (imported from contracts) and `isAllowlistRejection(error)` true.
- (3) Status `bloqueado` gives the same refusal.
- (4) The list row written as `'  OWQ-...@Rede-Demo.LOCAL '` through `allowEmail` matches an identity created lowercase, and sign-in succeeds.
- (5) Refresh: sign in while listed, flip to `bloqueado`, then `refreshSession({ refresh_token })` fails with the 403 sentinel.
- (6) super_admin exemption: a throwaway identity plus a `public.platform_admins` row, then `disallowEmail`, then sign-in succeeds.
- (7) verifyOtp rollback:
  - for an unlisted existing identity, `authAdmin().generateLink({ type: 'recovery', email })`;
  - `verifyOtp({ type: 'recovery', token_hash: properties.hashed_token })` is refused with the sentinel;
  - `allowEmail`, then the SAME hash succeeds.
- (8) `before_user_created` through real GoTrue: `authAdmin().inviteUserByEmail(unlisted)` and `authAdmin().generateLink({ type: 'signup', email: unlisted, password })` are each refused with status 403 and the sentinel, and `adminSql` finds no auth.users row. After `allowEmail` the invite succeeds; delete that identity afterwards.

**Web login** (CONTEXT: UX messages).
- In `apps/web/app/(auth)/entrar/actions.ts`, after the `isEmailNotConfirmed` branch and before the generic redirect, add `if (isAllowlistRejection(error)) redirect('/entrar?erro=nao-liberado')`.
- Extend the doc comment: GoTrue checks the password first, so this answer is only ever given to someone who typed the right password, and it is no existence oracle.
- In `entrar/page.tsx`, add an `erro === 'nao-liberado'` alert. Use the same `role="alert"` paragraph as `credenciais`, keeping one alert at a time, with `t('notAllowed')`.
- Add `"notAllowed": "Seu acesso ainda não foi liberado."` to `apps/web/messages/pt-BR/login.json` under `login`.

**E2E harness and tracer case.**
- In `apps/web/e2e/admin.ts`, export `allowEmail(email, status = 'liberado')` and `disallowEmail(email)` on the existing `sql()` client, with the same lower(btrim()) SQL as setup.ts. Do not wire them into `createMember` yet; that is Task 3.
- In `apps/web/e2e/login.spec.ts`, add a test whose title contains `261018-owq`:
  - `createMember(throwaway, SEED_PASSWORD, 'rede-demo')`;
  - `disallowEmail(throwaway)`;
  - fill `/entrar` with the right password and submit;
  - expect the URL `/entrar?erro=nao-liberado` and the visible text "Seu acesso ainda não foi liberado.";
  - clean up with `deleteUserByEmail` in a finally block.
- The explicit `disallowEmail` keeps this case meaningful after Task 3 lists `createMember` e-mails.

**pgTAP.** Create `supabase/tests/175-email-allowlist.sql`: `begin; select plan(n); ... select * from finish(); rollback;`, with fixture ids under prefix `17500000-` and a header in the 170 style. Assert:
- (a) Shape:
  - columns email, status, created_at and updated_at exist;
  - the email PK exists;
  - status defaults to liberado.
- (b) CHECKs:
  - inserting `'Upper@X.local'` throws 23514;
  - inserting `' pad@x.local'` throws 23514;
  - status `'pendente'` throws 23514;
  - a duplicate email throws 23505.
- (c) Exposure:
  - RLS is on, `relforcerowsecurity` is false and the policy count is 0;
  - `has_table_privilege` is false for anon and authenticated (select, insert, update, delete) and true for service_role select.
- (d) For both functions:
  - `prosecdef` is true and `'search_path=""' = any(proconfig)`;
  - `has_function_privilege` for execute is false for anon, authenticated, service_role and api_user, and true for supabase_auth_admin;
  - function owner equals the owner of `public.email_allowlist` and of `public.platform_admins`.
- (e) Behaviour of the token hook, called directly. RESEARCH: pgTAP cannot `set role supabase_auth_admin`; the integration suite proves the real call path.
  - A liberado e-mail returns exactly `jsonb_build_object('claims', <input claims>)`.
  - Bloqueado, absent, empty-email and missing-email inputs each return exactly `{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}`.
  - A mixed-case, space-padded claims.email of a listed address passes.
  - A `tests.auth_user` in `platform_admins` with no list row and an absent email claim passes with its claims.
  - A missing `user_id` falls through to the e-mail check without an exception.
- (f) The creation hook: listed returns `'{}'::jsonb`; absent, bloqueado and padded-but-unlisted return the error object; mixed case of a listed address returns `'{}'`.

Also add `('email_allowlist')` to the presence list of assertion 4 in `supabase/tests/010-rls-coverage.sql`, with a one-line comment (quick 261018-owq, global table, zero policies, pinned in 175).

**Commit.** Make one or two path-scoped commits, for example `feat(quick-261018-owq): gate token issuance on a global e-mail allowlist`.
  </action>
  <verify>
    <automated>pnpm db:generate 2>&1 | grep -q "No schema changes" && ENVS="$(docker inspect supabase_auth_rede-social --format '{{range .Config.Env}}{{println .}}{{end}}')" && printf '%s\n' "$ENVS" | grep -qx 'GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true' && printf '%s\n' "$ENVS" | grep -qx 'GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED=true' && awk '/^\[remotes\.production\.auth\.hook\.custom_access_token\]$/{f=1;next} /^\[/{f=0} f' supabase/config.toml | grep -qx 'enabled = false' && awk '/^\[remotes\.production\.auth\.hook\.before_user_created\]$/{f=1;next} /^\[/{f=0} f' supabase/config.toml | grep -qx 'enabled = false' && awk '/^\[auth\.hook\.custom_access_token\]$/{f=1;next} /^\[/{f=0} f' supabase/config.toml | grep -qx 'enabled = true' && pnpm supabase test db && pnpm --filter @rede-social/contracts exec vitest run tests/allowlist.test.ts && pnpm --filter @rede-social/api exec vitest run tests/integration/email-allowlist.test.ts && pnpm --filter @rede-social/web exec playwright test login.spec.ts --project=mobile-chromium -g '261018-owq'</automated>
  </verify>
  <done>
- The migrations apply on a fresh reset, and the drizzle schema shows no drift.
- The auth container runs with both hooks enabled, and production config declares both disabled.
- The whole pgTAP suite is green, including the new 175 file and the extended 010 file.
- email-allowlist.test.ts proves cases 1-8 against real GoTrue.
- An unlisted member who types the right password on /entrar sees "Seu acesso ainda não foi liberado." in a real browser.
- Seed users still log in.
- The commits are path-scoped and carry no co-author trailer.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Account creation refused in the API (signup pre-check, tenant admin pre-check, invite mapping) with the integration suite green</name>
  <files>packages/contracts/src/errors.ts, packages/core/server/http/api-error.ts, packages/core/server/tenancy/email-allowlist.ts, packages/core/server/tenancy/signup.ts, packages/core/server/platform/tenants.ts, packages/core/server/platform/invites.ts, packages/core/server/platform/invite-send.ts, packages/core/tests/invite-send.test.ts, apps/api/src/routes/public.ts, apps/api/tests/integration/email-allowlist.test.ts, apps/api/tests/integration/signup.test.ts, apps/api/tests/integration/admin-rules.test.ts, apps/api/tests/integration/member-admin.test.ts, apps/api/tests/integration/invites.test.ts, apps/api/tests/integration/platform-tenants.test.ts, apps/api/tests/integration/platform-domains.test.ts, apps/api/tests/integration/platform-branding.test.ts</files>
  <behavior>
    - POST /v1/public/signup/rede-demo with a fresh unlisted e-mail answers 403 with `error.code === 'EMAIL_NOT_ALLOWED'` and `error.message === 'Seu acesso ainda não foi liberado.'`, and no auth.users row exists for it.
    - The same request after `allowEmail` answers 201.
    - An existing identity whose e-mail is un-listed answers 403 EMAIL_NOT_ALLOWED, not 409. A listed duplicate keeps 409 EMAIL_ALREADY_REGISTERED.
    - A stale consent version still answers 400, and an unknown slug still answers 404. Both checks come before the allowlist.
    - POST /v1/platform/tenants with an unlisted adminEmail answers 400 VALIDATION_FAILED with `details.adminEmail === 'not_allowed'` and creates no tenant row.
    - A platform-account adminEmail keeps `in_use`, because identityKind runs first.
    - A listed adminEmail given in a different case with surrounding spaces answers 201.
    - Invite send or resend for an address listed at tenant creation and un-listed before the send answers 403 EMAIL_NOT_ALLOWED. The invite stays `pending` and no identity is created. After `allowEmail`, the same resend answers 200 with status `sent`.
    - `classifyInviteSendError(new ApiError(403, 'EMAIL_NOT_ALLOWED'))` returns `{ retry: false, lastError: 'invite:email_not_allowed' }`.
  </behavior>
  <action>
**Error code.**
- Add `'EMAIL_NOT_ALLOWED'` to `ERROR_CODES` in `packages/contracts/src/errors.ts`, right after `'EMAIL_ALREADY_REGISTERED'`. Keep TENANT_SUSPENDED directly after MEMBERSHIP_BLOCKED, as pinned by contracts/tests/platform.test.ts.
- Extend the doc comment: the stable refusal for an e-mail that is not on the global allowlist (quick 261018-owq).
- Add `EMAIL_NOT_ALLOWED: 'Seu acesso ainda não foi liberado.'` to `ERROR_MESSAGES` in `packages/core/server/http/api-error.ts`; typecheck forces it.

**Kernel helper.**
- Create `packages/core/server/tenancy/email-allowlist.ts` exporting `isEmailAllowed(tx: Tx, email: string): Promise<boolean>`.
- It selects one row from `emailAllowlist` where email equals `sql\`lower(btrim(${email}))\`` and status is `'liberado'`.
- Normalisation happens in SQL so it has exactly the hook's and the CHECK's semantics; JavaScript lowercasing differs for some non-ASCII input.

**signupMember** (`packages/core/server/tenancy/signup.ts`).
- After the stale-consent check and BEFORE `supabaseAdmin.auth.admin.createUser`, call `withAdminTx((tx) => isEmailAllowed(tx, body.email))`.
- When it returns false:
  - `log.warn({ event: 'signup.not_allowed', attemptedTenantId: tenantId, ip, userAgent }, 'e-mail not on the allowlist')`, with no e-mail in the log (PII), mirroring `signup.duplicate_email`;
  - then `throw new ApiError(403, 'EMAIL_NOT_ALLOWED')`.
- Update the "Order is load-bearing" comment with the new step. It runs before the duplicate path on purpose, because an unlisted existing identity cannot log in anyway. Enumeration through this answer is accepted by CONTEXT; the log line keeps it attributable.
- In the `created.error` branch, add `isAllowlistRejection(created.error)` → the same 403. It guards a future GoTrue that hooks the admin create.

**Route doc.** In `apps/api/src/routes/public.ts`, add a `403` response, "E-mail not on the platform allowlist (EMAIL_NOT_ALLOWED)", with `apiErrorEnvelopeSchema`, to the signup route.

**createTenant** (`packages/core/server/platform/tenants.ts`).
- Inside the existing `withAdminTx`, right after the `identityKind` platform-account refusal and before the tenants insert, call `isEmailAllowed(tx, adminEmail)`.
- When it returns false, `throw new ApiError(400, 'VALIDATION_FAILED', { adminEmail: 'not_allowed' })`. Nothing was inserted, so nothing rolls back.
- Comment: CONTEXT says tenant admins must be listed too; without this check the invite would fail later at GoTrue's before_user_created.

**Invites** (`packages/core/server/platform/invites.ts`).
- In the `inviteUserByEmail` failure branch (around 487-512), before the generic `revertClaim` + 500, add:
  - if `invited.error && isAllowlistRejection(invited.error)`: `await revertClaim(invite.id)`;
  - `log.warn({ event: 'invite.not_allowed', userId, tenantId, inviteId }, ...)`;
  - `throw new ApiError(403, 'EMAIL_NOT_ALLOWED')`.
- In the resend `generateLink` failure handling (around 790-845), add the same mapping: log `invite.resend_not_allowed`, keep whatever claim handling that path already does, and answer the 403.
- In `packages/core/server/platform/invite-send.ts`, make `classifyInviteSendError` return `{ retry: false, lastError: 'invite:email_not_allowed' }` for `ApiError` with code `EMAIL_NOT_ALLOWED`. A retry would only repeat the refusal until Igor lists the address.
- Add that case to `packages/core/tests/invite-send.test.ts`. Write it first: RED, then GREEN.

**Integration suite** (`apps/api/tests/integration/email-allowlist.test.ts`). Write the creation cases first, so they are RED against Task 1's code:
- (9) signup: unlisted 403 with code and message, no auth.users row; listed 201.
- (10) An existing identity created via `authAdmin().createUser`, then un-listed, signs up again: 403. A listed duplicate gives 409.
- (11) Stale consent or unknown slug with an unlisted e-mail still gives 400 or 404.
- (12) Tenant creation with a super_admin token (signInAs on the seed super admin, the way platform-tenants.test.ts does):
  - unlisted adminEmail: 400 with `details.adminEmail === 'not_allowed'` and no tenants row for the slug;
  - listed with odd case and spaces: 201;
  - delete the throwaway tenants afterwards.
- (13) Un-listed after creation:
  - `allowEmail`, create the tenant, `disallowEmail`;
  - attach and verify a `<slug>.localhost` domain (the pattern of invites.test.ts "resend lifecycle" beforeAll; do not run the scheduled job);
  - `POST …/invites/{id}/resend` gives 403 EMAIL_NOT_ALLOWED, the invite is still pending and no auth.users row exists;
  - `allowEmail`, then the same resend gives 200 `sent`.

**Fixture listing** (scope observed at planning time; extend only to files the full run shows red for an allowlist reason).
- In the `signup` helper of `signup.test.ts`, `admin-rules.test.ts` and `member-admin.test.ts`: when the payload carries a string e-mail, `await allowEmail(email)` before posting, so every existing case keeps its meaning.
- In the tenant-creation helpers, `await allowEmail(adminEmail)` before posting:
  - `invites.test.ts` `createTenantViaApi`;
  - `platform-domains.test.ts` and `platform-branding.test.ts` `createThrowawayTenant`;
  - every POST in `platform-tenants.test.ts` that builds a body with `newTenantBody` or an inline adminEmail and expects anything but the identityKind or schema refusals.
- In `invites.test.ts`, list every address invited through the API that is not created by `authAdmin().createUser`.
- Never weaken a hook, a pre-check or an existing assertion to turn a test green. The only fix allowed is listing the fixture's address.

**Gate.**
- Run `pnpm db:reset && pnpm db:seed` (memory: reset needs seed; UAT residue breaks seed-pinned tests), then `pnpm supabase test db` BEFORE `pnpm test:integration`.
- The full integration run may exceed the 10-minute tool limit. Run it in the background and wait for its exit status.
- Commit path-scoped, for example `feat(quick-261018-owq): refuse account creation for e-mails not on the allowlist`, with no co-author trailer.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/core exec vitest run tests/invite-send.test.ts && pnpm --filter @rede-social/contracts test && pnpm --filter @rede-social/api test && TURBO_CACHE=local:r pnpm turbo run typecheck lint --filter=@rede-social/api --filter=@rede-social/core --filter=@rede-social/contracts && pnpm guard:lanes && pnpm db:reset && pnpm db:seed && pnpm supabase test db && pnpm test:integration</automated>
  </verify>
  <done>
- Every behavior bullet is proven by email-allowlist.test.ts cases 9-13 and the core classifier test.
- The full pgTAP suite and the full `pnpm test:integration` (api + reuse-fixture) pass on a fresh reset and seed with both hooks enabled.
- typecheck, lint and guard:lanes are green.
- No hook, pre-check or existing assertion was weakened.
- The commits are path-scoped and carry no co-author trailer.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Creation screens say "não liberado" (cadastro, já tem conta, mail links, wizard) and the e2e harness lists its identities</name>
  <files>apps/web/app/(auth)/cadastro/[slug]/actions.ts, apps/web/app/(auth)/cadastro/[slug]/page.tsx, apps/web/messages/pt-BR/signup.json, apps/web/app/auth/confirm/route.ts, apps/web/app/auth/confirm/route.test.ts, apps/web/app/(platform)/plataforma/novo/actions.ts, apps/web/messages/pt-BR/platform.json, apps/web/e2e/admin.ts, apps/web/e2e/feed-admin.ts, apps/web/e2e/events-admin.ts, apps/web/e2e/members-admin.ts, apps/web/e2e/courses-admin.ts, apps/web/e2e/wizard.ts, apps/web/e2e/signup.spec.ts, apps/web/e2e/multi-tenant-identity.spec.ts, apps/web/e2e/admin-rules.spec.ts, apps/web/e2e/phase8-smoke.spec.ts, apps/web/e2e/auth-pages.spec.ts, apps/web/e2e/invite.spec.ts, apps/web/e2e/platform-tenants.spec.ts, apps/web/e2e/platform-domains.spec.ts, apps/web/e2e/platform.spec.ts</files>
  <behavior>
    - In route.test.ts, verifyOtp resolving `{ error }` where error has status 403 and message EMAIL_NOT_ALLOWED lands on `/entrar?erro=nao-liberado` for `type=signup`, `type=recovery` and `type=invite` with `next=/aceitar-convite`. The allowlist branch wins over the /convite-expirado and link-invalido fallbacks.
    - In route.test.ts, an `otp_expired` error keeps every existing destination.
    - E2E: an unlisted address submitted on /cadastro shows "Seu acesso ainda não foi liberado." and creates no auth.users row.
    - E2E: the wizard with an unlisted first-admin e-mail shows "Este e-mail ainda não foi liberado para acessar a plataforma. Libere-o antes de criar o tenant." and creates no tenant.
  </behavior>
  <action>
**Mail links** (`apps/web/app/auth/confirm/route.ts`).
- Write the route.test.ts cases first (RED), following the existing `destination()` harness. The error is an Error carrying `status: 403` and the sentinel message.
- Inside the `tokenHash && isOtpType(type)` block, after the success branch, add `if (isAllowlistRejection(error)) redirect('/entrar?erro=nao-liberado')`.
- Doc comment: GoTrue rolled back the exchange, so the token is not consumed and the same mail link works once the e-mail is listed (proved by email-allowlist.test.ts case 7).

**Sign-up** (`apps/web/app/(auth)/cadastro/[slug]/actions.ts`).
- In `signup`, before the generic `!res.ok`, handle `res.status === 403`: read the envelope with `apiErrorEnvelopeSchema.safeParse` on the parsed JSON, and when `error.code === 'EMAIL_NOT_ALLOWED'` redirect to `${base}?erro=nao-liberado`. Any other 403 falls through to the generic.
- In `joinFromSignup`, after the `isEmailNotConfirmed` branch and before `erro=senha`, redirect to `${state}&erro=nao-liberado` when `isAllowlistRejection(error)`. Today that case wrongly says "Senha incorreta".
- In `page.tsx`, add `erro === 'nao-liberado'` → `t('notAllowed')` in BOTH branches: the draft ("já tem conta") alert chain and the form branch, with the same `role="alert"` paragraph as `validacao`.
- Add `"notAllowed": "Seu acesso ainda não foi liberado."` under `signup` in `apps/web/messages/pt-BR/signup.json`.

**Wizard** (`apps/web/app/(platform)/plataforma/novo/actions.ts`).
- Add `'emailNotAllowed'` to the `DraftFieldError` union.
- Map `details?.adminEmail === 'not_allowed'` → `fieldErrors.adminEmail = 'emailNotAllowed'` next to the `in_use` line, and extend the doc comment.
- Add `"emailNotAllowed": "Este e-mail ainda não foi liberado para acessar a plataforma. Libere-o antes de criar o tenant."` under `platform.new.errors` in `apps/web/messages/pt-BR/platform.json`. NewTenantForm, WizardPersonalization and CreateTenantDialog already render `new.errors.${key}`.

**E2E harness** (scope observed at planning time; extend only to specs the gate run shows red for an allowlist reason).
- `admin.ts` `createMember`: `await allowEmail(email)` before the GoTrue create.
- `feed-admin.ts`, `events-admin.ts`, `members-admin.ts`, `courses-admin.ts`: import `allowEmail` from `./admin` and call it before their create.
- `wizard.ts` `fillTenantData`: `await allowEmail(input.email)` before filling. A garbage address row passes the CHECK and is harmless.
- `invite.spec.ts`: list `adminEmail` in its tenant-creation helper and every `mti-…` address it invites or signs up.
- `platform-tenants.spec.ts`, `platform-domains.spec.ts`, `platform.spec.ts`: list each admin e-mail typed or posted for a tenant that is expected to be created.
- `signup.spec.ts`, `multi-tenant-identity.spec.ts`, `admin-rules.spec.ts`, `phase8-smoke.spec.ts`, `auth-pages.spec.ts`: list every throwaway address before its /cadastro submit. In signup.spec.ts that is next to `uniqueEmail()`.
- New e2e cases, with titles containing `261018-owq`:
  - In signup.spec.ts: a fresh address with no `allowEmail` submitted on `/cadastro` with valid fields and consents lands on `?erro=nao-liberado`, shows the pt-BR text, and the admin users lookup the spec already uses finds no identity.
  - In platform-tenants.spec.ts, modelled on the `in_use` case (~line 527): fill the wizard data, `disallowEmail` the admin address, go through to the summary confirmation, and expect the emailNotAllowed text under or listed for adminEmail, with no tenant row for the slug.

**Gate.**
- Run `pnpm db:reset && pnpm db:seed`, then the e2e list below on mobile-chromium. CI runs both projects on push.
- If a dev server is reused (Playwright `reuseExistingServer`), make sure it reloaded the new code, or stop it so Playwright starts fresh.
- Run the e2e command in the background if it exceeds the 10-minute tool limit.
- Commit path-scoped, for example `feat(quick-261018-owq): allowlist messages on sign-up and mail links; e2e harness lists its identities`, with no co-author trailer.

**SUMMARY.** Write `.planning/quick/261018-owq-allowlist-global-de-e-mails-para-cadastr/261018-owq-SUMMARY.md` with the production runbook from the output section.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web test && TURBO_CACHE=local:r pnpm turbo run typecheck lint --filter=@rede-social/web && bash scripts/check-ui-literals.sh && test -z "$(for f in $(grep -lE 'auth/v1/admin/users[^/?]' apps/web/e2e/*.ts); do grep -q 'allowEmail(' "$f" || echo "$f"; done)" && pnpm db:reset && pnpm db:seed && pnpm --filter @rede-social/web exec playwright test login.spec.ts signup.spec.ts auth-pages.spec.ts recovery.spec.ts invite.spec.ts multi-tenant-identity.spec.ts admin-rules.spec.ts phase8-smoke.spec.ts phase2-smoke.spec.ts platform-tenants.spec.ts platform-wizard.spec.ts platform-domains.spec.ts platform.spec.ts members.spec.ts feed.spec.ts events.spec.ts courses-admin.spec.ts --project=mobile-chromium</automated>
  </verify>
  <done>
- route.test.ts proves the mail-link mapping.
- The new e2e cases prove the /cadastro and wizard messages in a real browser.
- Every e2e identity helper lists its e-mail.
- The 17 listed specs pass on mobile-chromium after a fresh reset and seed with both hooks enabled.
- Web typecheck, lint and the UI-literal check are green.
- The SUMMARY holds the runbook.
- The commits are path-scoped and carry no co-author trailer.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → GoTrue (/auth/v1/token, /verify, /otp, /signup) | Anyone holding the publishable key can call GoTrue directly, bypassing the web BFF |
| browser → web BFF → API (/v1/public/signup, /v1/platform/tenants) | Untrusted sign-up and wizard input |
| API (service role) → GoTrue admin (createUser, inviteUserByEmail, generateLink) | Trusted caller; admin createUser bypasses before_user_created |
| GoTrue (supabase_auth_admin) → Postgres hook functions | Runs inside GoTrue's transaction with a 2 s timeout; a failure blocks every login |
| PostgREST / Data API → public schema | Must never reach the list or the functions |
| SQL Editor (Igor) → public.email_allowlist | The only writer in production |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-owq-01 | Spoofing / Elevation | Hook bypass through direct GoTrue calls (password, refresh_token and pkce grants, /verify, verifyOtp) | high | mitigate | The custom_access_token hook runs in GoTrue's GenerateAccessToken for every grant, so no client path skips it. Public /signup stays closed (enable_signup = false, pinned by gotrue-signup-disabled.test.ts). email-allowlist.test.ts cases 2, 3, 5 and 7 call GoTrue directly with the publishable key (password, refresh, verifyOtp) and get the 403 sentinel. |
| T-owq-02 | Elevation | auth.admin.createUser skips before_user_created (RESEARCH finding) | high | mitigate | `isEmailAllowed` pre-check in signupMember before createUser (403) and in createTenant (400 not_allowed). An `isAllowlistRejection` branch guards a future GoTrue. The token hook stays the backstop for any other admin-created identity. Proven by cases 9, 10 and 12. |
| T-owq-03 | Denial of Service | A broken custom_access_token hook locks out everyone, super_admin included | high | mitigate | Super_admin branch first; trivial body with PK lookups only and the single uuid cast on a GoTrue-supplied id. Function owner = table owner (postgres), without FORCE RLS, so the definer always reads both tables (pgTAP 175 d). Behaviour matrix in pgTAP and real-GoTrue case 6. Production ships `enabled = false`; rollback is `enabled = false` + config push or the Dashboard hook toggle (runbook). |
| T-owq-04 | Tampering / Spoofing | E-mail case or whitespace mismatch lets a variant slip through, or locks a listed person out | medium | mitigate | CHECK `email = lower(btrim(email))` on write. Hooks, `isEmailAllowed`, the seed and the test helpers all normalise in SQL with lower(btrim()). pgTAP 175 b/e/f and integration case 4 prove that mixed case and padding match and that uppercase storage throws 23514. |
| T-owq-05 | Information Disclosure / Tampering | Table or functions exposed through PostgREST, the Data API or a tenant lane | high | mitigate | RLS on with 0 policies; `revoke all` on the table from anon and authenticated; function EXECUTE revoked from public, anon, authenticated and service_role, granted only to supabase_auth_admin. The Data API exposes only data_api_closed (quick 261009-8fz). pgTAP 175 c/d pins table and function privileges and the zero-policy count. |
| T-owq-06 | Elevation | SECURITY DEFINER search_path hijack | high | mitigate | `set search_path = ''` on both functions; every relation fully qualified (public.email_allowlist, public.platform_admins); built-ins resolve from pg_catalog only. pgTAP 175 d asserts prosecdef and `search_path=""` in proconfig. |
| T-owq-07 | Information Disclosure | Allowlist enumeration through the sign-up answer (403 vs 201/409) | low | accept | Accepted by CONTEXT ("Accepted that signup reveals whether an e-mail is on the list"). `signup.not_allowed` warn line with ip/userAgent keeps probing attributable, with no e-mail in logs. Login reveals nothing new: GoTrue checks the password before issuing (RESEARCH). |
| T-owq-08 | Denial of Service | A 5xx hook answer makes supabase-js retry (auto-refresh storms) | medium | mitigate | `http_code` is always 403 (4xx → non-retryable AuthApiError); pinned in pgTAP 175 e/f. |
| T-owq-09 | Repudiation | List edits in the SQL Editor leave no audit trail | low | accept | Manual maintenance by Igor is a locked decision. `updated_at` is kept on upsert. An admin UI with an audit log is out of scope. |
| T-owq-10 | Elevation | A blocked person keeps a valid access token until it expires | low | accept | Accepted by CONTEXT (≤ access-token TTL, ~1 h). An immediate-revocation middleware check is out of scope. |
| T-owq-11 | Denial of Service | Enabling hooks on a hosted project before the migration or before the list is populated | high | mitigate | `[remotes.production.auth.hook.*] enabled = false` (locked). deploy-api.yml runs `db push` before `config push`. The runbook orders: populate, check the "who would be locked out" query, flip, push, smoke the super_admin login. A future [remotes.homolog] carries the same disabled blocks. |
| T-owq-SC | Tampering | Package installs | low | accept | No new npm/pip/cargo dependency; every library used (drizzle-orm, @supabase/supabase-js, postgres, Playwright) is already pinned in the workspace. |
</threat_model>

<verification>
Gates must pass in this order on the local stack. Production is never touched.

1. Task 1 gate:
   - drizzle drift check;
   - auth container env shows both hooks enabled;
   - config remote blocks show both hooks disabled;
   - full pgTAP;
   - contracts allowlist unit test;
   - email-allowlist.test.ts cases 1-8;
   - login e2e tracer case.
2. Task 2 gate:
   - core, contracts and api unit tests;
   - api/core/contracts typecheck and lint;
   - guard:lanes;
   - fresh `pnpm db:reset && pnpm db:seed`;
   - full pgTAP, then the full `pnpm test:integration`.
3. Task 3 gate:
   - web unit tests;
   - web typecheck and lint;
   - UI-literal check;
   - e2e helper listing completeness;
   - fresh reset and seed;
   - the 17 affected e2e specs on mobile-chromium.
4. `git log` for this quick's commits shows only explicit paths, nothing under `.planning/phases/08.7-*`, no STATE.md, and no co-author trailer.
</verification>

<success_criteria>
- An unlisted or `bloqueado` e-mail can neither obtain a token nor create an account through any local path (GoTrue direct, web BFF, API, platform invites). A `liberado` e-mail works whatever its case. super_admin is never locked out.
- "Seu acesso ainda não foi liberado." appears on /entrar and /cadastro, and the wizard shows its field error.
- pgTAP, the full integration suite and the affected e2e specs are green with both hooks enabled locally.
- Production config ships both hooks disabled, and the SUMMARY carries the runbook Igor needs to go live.
</success_criteria>

<output>
Create `.planning/quick/261018-owq-allowlist-global-de-e-mails-para-cadastr/261018-owq-SUMMARY.md`. It must include a section "Production runbook (Igor)" with these steps.

1. **Push.** deploy-api.yml applies `supabase db push --include-roles`, which creates `public.email_allowlist` and both hook functions. It then runs `supabase config push`, which sends both hooks with `enabled = false`, so logins do not change.
   - The new API revision refuses sign-ups and tenant first-admins whose e-mail is not listed as soon as it is live. This is the intended policy, and it locks out no existing account.
2. **Populate** in the SQL Editor of project qjjhtduxquvlfppybpqq. Run one upsert per e-mail:
   `insert into public.email_allowlist (email, status) values (lower(btrim('x@y')), 'liberado') on conflict (email) do update set status = excluded.status, updated_at = now();`
   To block someone, upsert the same e-mail with status `bloqueado`.
3. **Check who would be locked out** before enabling:
   `select u.email from auth.users u where not exists (select 1 from public.platform_admins pa where pa.user_id = u.id) and not exists (select 1 from public.email_allowlist a where a.email = lower(btrim(u.email)) and a.status = 'liberado');`
   It must list only the people Igor intends to block.
4. **Enable.** Flip `enabled = false` to `enabled = true` in both `[remotes.production.auth.hook.before_user_created]` and `[remotes.production.auth.hook.custom_access_token]`. Commit and push, so the deploy runs config push, or run `supabase config push --project-ref qjjhtduxquvlfppybpqq --yes` by hand.
5. **Smoke.**
   - The super_admin logs in.
   - A listed member logs in.
   - An unlisted throwaway sign-up shows "Seu acesso ainda não foi liberado.".
   - Assumptions A2/A3 hold (the hosted GoTrue keeps the hook contract, and the definer reads both tables).
6. **Rollback.** Set both blocks back to `enabled = false` and config push, or turn the hooks off in Dashboard → Authentication → Hooks. Blocking applies on the next token refresh (≤ 1 h).
7. **hml.** There is no `[remotes.homolog]` today. When it is added, carry both hook blocks with `enabled = false` until hml's own list is populated, and apply the same migration.

The SUMMARY also records:
- the observed GoTrue error shape;
- which harness choke points were changed (seed `ensureUser`, setup.ts `authAdmin` wrapper, e2e `createMember` and the four helpers, `wizard.ts`);
- any spec or test file the gate runs forced beyond the planned list, and why;
- the gate outputs.
</output>
