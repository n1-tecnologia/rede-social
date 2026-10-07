---
phase: quick-261007-gzu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/*_membership_email_unconfirmed.sql
  - supabase/migrations/*_confirm_existing_auth_emails.sql
  - supabase/migrations/meta/_journal.json
  - supabase/migrations/meta/*_snapshot.json
  - supabase/tests/170-membership-email-unconfirmed.sql
  - packages/contracts/src/moderation.ts
  - packages/contracts/tests/moderation.test.ts
  - packages/core/server/tenancy/admin-members.ts
  - apps/api/src/routes/admin/members.ts
  - apps/api/tests/integration/member-admin.test.ts
  - apps/api/tests/integration/confirm-existing-emails.test.ts
  - apps/web/components/admin/AdminMemberRow.tsx
  - apps/web/components/admin/MemberAdminSheet.test.tsx
  - apps/web/messages/pt-BR/admin.json
  - apps/web/e2e/admin.ts
  - apps/web/e2e/admin-members.spec.ts
  - docs/deploy/auth-mail.md
autonomous: true
requirements: [ADMIN-02, AUTH-02, TENANT-05]
tags: [auth, email-verification, admin-members, security-definer, backfill, pgtap, pt-BR]

estimate:
  tokens: 90000
  raw_tokens: 90000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "GET /v1/admin/members and GET /v1/admin/members/{membershipId} answer emailUnconfirmed true for a member whose auth.users.email_confirmed_at is null and false for everyone else. Such members stay listed (Todos and Ativos), and ordering, filters, pagination and counts are exactly what they were."
    - "Only a boolean leaves the database. api_user and the admin lane (service_role) hold no SELECT on auth.users (probed on the live stack), so the single reader is app.membership_email_unconfirmed(p_tenant_id, p_membership_id): SECURITY DEFINER, search_path empty, executable by service_role only, and it answers false for a membership of another tenant, a soft-deleted membership or an unknown id."
    - "The field exists only on the admin rows (members.manage or moderation.manage). The member-facing directory and profile answers carry no trace of it, and a rede-lab admin never sees a rede-demo row or its state."
    - "The Membros row and the member sheet show a warning pill 'E-mail não confirmado' (next-intl catalog) for an unconfirmed active or blocked member; a confirmed member shows none; an invited row keeps only 'Convite pendente' (the invite already says the address is unverified)."
    - "A new hand-written, idempotent migration confirms pre-existing unconfirmed non-invited accounts that were created before the sign-up confirmation code existed. It leaves invited identities and every account created at or after the cutoff untouched, so a late or repeated run can never confirm a legitimately pending sign-up. It is created and applied on the local stack only."
    - "docs/deploy/auth-mail.md documents the badge, the one-time backfill and its guard, the deploy order (backfill before or with the config push that enables confirmations) and the release order of the new response field."
  artifacts:
    - path: "supabase/migrations/*_membership_email_unconfirmed.sql"
      provides: "app.membership_email_unconfirmed(uuid, uuid): tenant-scoped boolean over auth.users.email_confirmed_at"
      contains: "membership_email_unconfirmed"
    - path: "supabase/tests/170-membership-email-unconfirmed.sql"
      provides: "pgTAP: privileges, hardening, behaviour and the cross-tenant negatives"
      contains: "membership_email_unconfirmed"
    - path: "packages/contracts/src/moderation.ts"
      provides: "adminMemberSchema.emailUnconfirmed (optional boolean)"
      contains: "emailUnconfirmed"
    - path: "packages/core/server/tenancy/admin-members.ts"
      provides: "projection column email_unconfirmed and AdminMember.emailUnconfirmed"
      contains: "membership_email_unconfirmed"
    - path: "apps/web/components/admin/AdminMemberRow.tsx"
      provides: "the warning pill in MemberPills (row and sheet)"
      contains: "emailUnconfirmed"
    - path: "apps/web/messages/pt-BR/admin.json"
      provides: "admin.members.pills.emailUnconfirmed"
      contains: "E-mail não confirmado"
    - path: "supabase/migrations/*_confirm_existing_auth_emails.sql"
      provides: "one-time guarded backfill of auth.users.email_confirmed_at"
      contains: "email_confirmed_at"
    - path: "apps/api/tests/integration/confirm-existing-emails.test.ts"
      provides: "runs the shipped migration file against the live local database"
      contains: "confirm_existing_auth_emails"
    - path: "docs/deploy/auth-mail.md"
      provides: "badge, backfill, guard and ordering documentation"
      contains: "backfill"
  key_links:
    - from: "packages/core/server/tenancy/admin-members.ts"
      to: "app.membership_email_unconfirmed"
      via: "projection() passes ctx.tenantId (the membership of record) and m.id inside withAdminTx (set local role service_role)"
    - from: "packages/contracts/src/moderation.ts"
      to: "apps/web/lib/admin-members.ts"
      via: "adminMemberPageSchema.parse is STRICT: the new key must be declared or the Membros page refuses the answer"
    - from: "apps/web/components/admin/AdminMemberRow.tsx"
      to: "apps/web/messages/pt-BR/admin.json"
      via: "t('members.pills.emailUnconfirmed')"
    - from: "apps/api/tests/integration/confirm-existing-emails.test.ts"
      to: "supabase/migrations/*_confirm_existing_auth_emails.sql"
      via: "reads the file from disk and executes it with adminSql.unsafe, so the shipped SQL is what is tested"
---

<objective>
Follow-up of quick 261007-gbk (sign-up e-mail verification). That plan left two documented loose ends: unconfirmed members appear in the tenant admin's Membros list with no sign, and accounts that existed before confirmations were switched on are not protected from being locked out.

Request (1): the tenant admin's member list (API and UI) keeps showing members whose e-mail is unconfirmed, now with a pt-BR badge "E-mail não confirmado", derived from `auth.users.email_confirmed_at is null`. Only a boolean is exposed. Tenant isolation and the admin permission gate are untouched. Counts stay as they are.

Request (2): a new idempotent hand-written Supabase migration marks existing `auth.users` with a null `email_confirmed_at` as confirmed, so nobody who already existed is blocked now that confirmations are on. It is created and applied on the local stack only (no production or homolog apply, no db push).

Purpose: the admin can tell a sign-up that is still waiting for its e-mail from a real member, and the switch-on of confirmations cannot lock out anyone who signed up under the old autoconfirm rule.

Output: a tenant-scoped security-definer function plus pgTAP, the contract/kernel/route change, the pill with unit and e2e tests, the backfill migration with a test that runs the shipped file, and the documentation.

Design decisions made at planning time (from reading the live code and database, not assumed):
- READ PATH. Probed on the local stack: neither `service_role` (the admin lane that serves the member list) nor `api_user` holds SELECT on `auth.users`, so a join is impossible and the admin lane cannot "just read it". The repo already has the least-privilege pattern for exactly this, `app.identity_has_password` (SECURITY DEFINER, `search_path = ''`, boolean only, revoked from public). This plan follows it but scopes the function by tenant AND membership, because the existing one is keyed by a bare user id and would be a cross-tenant oracle if reused. Alternatives rejected: a scalar by user id (not tenant-scoped); mirroring `email_confirmed_at` into `public.users` with a trigger (a trigger on a GoTrue-owned table that fires on every sign-in update, stale-state risk, and a new column in a core table); a GoTrue admin API call per page (N HTTP calls and the service key inside a read path).
- THE TENANT ARGUMENT IS THE REQUEST'S, NOT THE ROW'S. The projection passes `ctx.tenantId` (the membership of record) to the function, not `m.tenant_id`. If a future edit ever dropped the `m.tenant_id` predicate, other tenants' rows would read false instead of leaking.
- CONTRACT SHAPE. `emailUnconfirmed` is `.optional()`, following the Phase 8 precedent recorded in docs/DEPLOY.md ("The NEW web declares both fields .optional(), so it reads the OLD API's answers unchanged"): the web parses every API answer with STRICT schemas. The API always emits a real boolean. Release order for this field is therefore migrations, then web, then API (an old web refuses an unknown key from a new API).
- INVITED ROWS. The API reports the raw fact. The UI hides the pill when `status` is `invited`: a GoTrue-invited identity is unconfirmed until it accepts, and "Convite pendente" already says that, so a second pill is noise.
- BACKFILL GUARDS (request (2) asked to guard against a re-run confirming pending sign-ups "if cheaply possible"). Two cheap, deterministic guards, no clock at run time: (a) `created_at` strictly earlier than the instant sign-up confirmation code was committed (commit 1bad76a, 2026-10-07T11:58:35-03:00 = 2026-10-07 14:58:35+00). Production creates unconfirmed identities only after that code ships, and any account created before it was autoconfirmed, so every legitimately pending sign-up is newer than the cutoff and is never touched, however late or often the file runs. (b) `invited_at is null`: a pending GoTrue invite is not an "existing account that would be blocked" (its invite link confirms it on acceptance and works regardless of the confirmations setting), and confirming it early only risks interfering with the invite exchange. This second guard goes one step beyond the literal request; it is flagged in the return message and is a one-line removal if the developer disagrees.
- TERMINOLOGY. Copy and docs say "tenant" / "rede social do tenant", never "comunidade" (an internal resource).
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@.planning/quick/261007-gbk-verifica-o-de-e-mail-no-cadastro-com-tem/261007-gbk-PLAN.md
@.planning/quick/261007-gbk-verifica-o-de-e-mail-no-cadastro-com-tem/261007-gbk-SUMMARY.md
@docs/deploy/auth-mail.md
@packages/core/server/tenancy/admin-members.ts
@packages/contracts/src/moderation.ts
@supabase/migrations/20261006215630_identity_has_password.sql
@apps/web/components/admin/AdminMemberRow.tsx

Project rules that bind this plan:
- Tenant isolation is non-negotiable; every pt-BR string lives in a next-intl catalog (`scripts/check-ui-literals.sh` runs inside `pnpm lint`); Biome lint; Vitest; `redirect()` never inside try/catch.
- COMMITS: public repo. Commit messages carry NO Co-Authored-By trailer and no Claude attribution (user memory rule, overriding any default). Commit once per task. The working tree already holds unrelated uncommitted edits (MediaLibrary.tsx, several e2e specs, csp.ts, csp.test.ts, docs/DEPLOY.md and untracked tooling): stage ONLY this plan's files by explicit path, never `git add -A` or `git add .`, and do not edit docs/DEPLOY.md.
- Gates: run package gates with `pnpm --filter <pkg> exec vitest run <file>` (the integration script ignores a trailing file filter), and use `TURBO_CACHE=local:r` for any turbo run (the turbo cache fills the disk). Run pgTAP (`pnpm supabase test db`) BEFORE the integration suites (pgTAP file 154 trips on integration residue).
- Local stack facts: Supabase is running (Mailpit at http://127.0.0.1:54324). Apply migrations with `pnpm supabase migration up` only. Never `db reset` (needs a re-seed), never `db push`, never `link`, never touch production or homolog. Migrations are generated with `pnpm db:generate --custom --name=<name>` (drizzle-kit writes the empty SQL file, the `_journal.json` entry and a snapshot; commit all three).
- Never read `apps/api/.env.local` or any `.env*` file (a hook blocks it); the integration suites get their environment through `apps/api/vitest.config.ts`, and `SEED_PASSWORD` defaults to Segredo123 if a run reports it missing.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Tracer - an unconfirmed member's admin row reports it, from auth.users to GET /v1/admin/members</name>
  <reversibility rating="reversible">An additive function and an optional response key; nothing is altered or dropped, and removing both is a two-file change.</reversibility>
  <files>supabase/migrations/*_membership_email_unconfirmed.sql, supabase/migrations/meta/_journal.json, supabase/migrations/meta/*_snapshot.json, supabase/tests/170-membership-email-unconfirmed.sql, packages/contracts/src/moderation.ts, packages/contracts/tests/moderation.test.ts, packages/core/server/tenancy/admin-members.ts, apps/api/src/routes/admin/members.ts, apps/api/tests/integration/member-admin.test.ts</files>
  <read_first>
    - supabase/migrations/20261006215630_identity_has_password.sql (the header style, hardening and grants to copy) and supabase/tests/040-schema-conventions.sql lines 320-370 (how that function is asserted)
    - supabase/tests/160-shared-identity.sql lines 1-60 and its tail (file shape: begin, plan, fixtures with tests.tenant / tests.auth_user / tests.member, finish, rollback, and how a lane switch is undone) and supabase/tests/000-helpers.sql (tests.as_service, tests.as_tenant, tests.as_api_user)
    - packages/core/server/tenancy/admin-members.ts (projection, toMember, the three call sites of projection) and packages/contracts/src/moderation.ts lines 207-237 (adminMemberSchema)
    - packages/contracts/tests/moderation.test.ts lines 175-195 (the adminMemberSchema describe)
    - apps/api/tests/integration/member-admin.test.ts lines 1-135 (RUN, throwaway(), request(), list(), person(), adminSql) and 370-402 (walk, listSnapshot) and the last describe of the file
    - apps/api/src/routes/admin/members.ts lines 66-85 (the list route's 200 description)
  </read_first>
  <behavior>
    - pgTAP 170 (own fixture ids 17000000-..., tenants pgtap-ue-a and pgtap-ue-b, users used by no other file; make an identity unconfirmed with an update of auth.users.email_confirmed_at to null as the migration role). Fixture: tenant A holds an unconfirmed member, a confirmed member and an unconfirmed member whose membership is then soft-deleted; tenant B holds an unconfirmed member.
    - pgTAP assertions (count them and set plan(N) to match): the function exists with args (uuid, uuid); it returns boolean; it is SECURITY DEFINER; its search_path is pinned to the empty string; service_role may execute it; authenticated may NOT; anon may NOT; the bare api_user may NOT (NOINHERIT, it owns nothing until it opens a lane); A's unconfirmed membership under tenant A is true; A's confirmed membership under A is false; the same unconfirmed membership called through the admin lane (tests.as_service) is true; A's unconfirmed membership asked under tenant B is false (cross-tenant negative); B's unconfirmed membership asked under tenant A is false (reverse negative); the soft-deleted membership of an unconfirmed identity is false; an unknown membership id is false (not null, not an error); null arguments are false; after the update that confirms A's unconfirmed identity the same call is false; a call from the tenant lane (tests.as_tenant) is refused with SQLSTATE 42501.
    - Contract: adminMemberSchema accepts a row with emailUnconfirmed true, with false, and with the key absent (an older API); refuses a non-boolean value; still refuses an unknown key.
    - Integration (new top-level describe appended at the END of member-admin.test.ts, with its own throwaways built by the existing throwaway() helper, then made unconfirmed with adminSql): in tenant rede-demo an unconfirmed active member, a confirmed active member and an unconfirmed invited admin; in rede-lab one unconfirmed active member.
    - Integration: the list (walk with limit 50) reports emailUnconfirmed true for the unconfirmed active member and for the unconfirmed invited row (the API reports the raw fact, status stays invited), false for the confirmed throwaway and for the seeded admin and member; the unconfirmed member is still returned under status=active and under Todos, and the unfiltered list still equals listSnapshot(ids.demo) in length and order (nothing hidden, counts unchanged).
    - Integration: GET /v1/admin/members/{id} for the unconfirmed member answers emailUnconfirmed true; after adminSql sets email_confirmed_at to now() both the single read and the list answer false.
    - Integration, tenant isolation: the rede-lab admin's walk contains the rede-lab throwaway with emailUnconfirmed true and none of the rede-demo throwaways; the rede-demo admin's walk does not contain the rede-lab throwaway; through adminSql, app.membership_email_unconfirmed called with the rede-lab tenant id and the rede-demo unconfirmed membership id is false while the same call with the rede-demo tenant id is true.
    - Integration, privacy: the seeded member's GET /v1/members?limit=50 answer (the member-facing directory) is 200 and its serialized body contains no occurrence of the substring nconfirmed.
  </behavior>
  <action>
    Tests first, each run red before its implementation. Per request (1).

    1. Write the three test pieces named in behavior: the pgTAP file supabase/tests/170-membership-email-unconfirmed.sql (shaped like 160-shared-identity.sql: begin, plan, fixtures, assertions, finish, rollback, undoing each lane switch the way 160 does), the extra cases in packages/contracts/tests/moderation.test.ts, and the new describe at the end of apps/api/tests/integration/member-admin.test.ts (add its throwaways in a beforeAll inside the describe; the file-level afterAll already deletes everything pushed to throwawayUsers). Run `pnpm supabase test db` (only file 170 may fail: missing function), the contracts test and the integration file, and confirm they fail for the right reason. If the bare-api_user privilege assertion later contradicts the NOINHERIT premise (the helpers file states api_user owns nothing until it opens a lane), stop and report what the database says instead of loosening the assertion.
    2. Create the migration with `pnpm db:generate --custom --name=membership_email_unconfirmed` and write it in the header-comment style of the identity_has_password migration, with a WHY block that states: request (1); that neither api_user nor the admin lane service_role can read auth.users (verified on the live stack, so a join in the admin list is impossible); why a user-id-keyed boolean was rejected (no tenant scope, cross-tenant oracle); why a trigger mirror and a GoTrue admin call were rejected; that the function is called from withAdminTx with ctx.tenantId and m.id; the hardening; and that it is expand-only (a new function, nothing altered or dropped, so the API revision still serving during the push is unaffected). The function is app.membership_email_unconfirmed(p_tenant_id uuid, p_membership_id uuid) returning boolean, language sql, stable, security definer, search_path set to the empty string. Its body is a coalesce, defaulting to false, over one subselect that joins public.memberships m to auth.users u on u.id = m.user_id where m.id equals p_membership_id, m.tenant_id equals p_tenant_id and m.deleted_at is null, and selects whether u.email_confirmed_at is null. Every name is schema-qualified. Separate the statements with the statement-breakpoint marker the other migrations use; revoke all on the function from public; grant execute to service_role ONLY (the admin lane is the single caller; no grant to api_user, authenticated or anon). Apply it to the LOCAL stack with `pnpm supabase migration up`.
    3. Contract (packages/contracts/src/moderation.ts): add `emailUnconfirmed` to adminMemberSchema as an optional boolean, with a doc paragraph: ADMIN ONLY like the e-mail; true exactly when the identity's e-mail is unconfirmed (a sign-up still waiting for its mail, or a pending GoTrue invite); absent means an API that predates the field, which the web reads as confirmed; the schema stays strict and the web parses it strictly, which fixes the release order (migrations, web, API) per the Phase 8 precedent in docs/DEPLOY.md.
    4. Kernel (packages/core/server/tenancy/admin-members.ts): change projection to take the request context pieces it needs (tenantId and userId) instead of the bare viewer id, and add the column that calls app.membership_email_unconfirmed with ${ctx.tenantId}::uuid and m.id, aliased email_unconfirmed. Update all three call sites, the AdminMemberRow type, and toMember (emailUnconfirmed from the row). Add a doc paragraph "E-MAIL CONFIRMATION" to the file's header explaining the function as the only reader of auth.users, why the tenant argument is the request's tenantId rather than the row's tenant_id, and that only a boolean leaves. No new filter, no new query parameter, no change to ordering, cursor or counts.
    5. Route (apps/api/src/routes/admin/members.ts): extend the list route's 200 description and the single-read description to mention emailUnconfirmed (admin-only boolean, true while the address is unconfirmed).
    6. Run the three test pieces green, then `pnpm --filter @rede-social/contracts typecheck`, core and api typecheck and lint. Commit (explicit paths, including the generated meta files) with a message such as: feat(quick-261007-gzu): admin member rows report an unconfirmed e-mail through a tenant-scoped security-definer function.
  </action>
  <verify>
    <automated>pnpm supabase migration up && pnpm supabase test db && pnpm --filter @rede-social/contracts exec vitest run tests/moderation.test.ts && pnpm --filter @rede-social/api exec vitest run tests/integration/member-admin.test.ts && pnpm --filter @rede-social/contracts typecheck && pnpm --filter @rede-social/core typecheck && pnpm --filter @rede-social/api typecheck && pnpm --filter @rede-social/contracts lint && pnpm --filter @rede-social/core lint && pnpm --filter @rede-social/api lint</automated>
  </verify>
  <done>The whole pgTAP suite is green including file 170 (18 assertions or whatever the final count is); GET /v1/admin/members answers emailUnconfirmed true for an unconfirmed active member and false for a confirmed one without hiding or reordering anything; a rede-lab admin and an adminSql call with the wrong tenant id both read false for a rede-demo membership; the member directory answer carries no trace of the field; the migration, its journal entry and its snapshot are committed; the privilege assertions in file 170 pass (service_role may execute the function; authenticated, anon and the bare api_user may not), which is the proof that the grant list is exactly one role.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: The "E-mail não confirmado" pill on the Membros row and the member sheet</name>
  <files>apps/web/components/admin/AdminMemberRow.tsx, apps/web/messages/pt-BR/admin.json, apps/web/components/admin/MemberAdminSheet.test.tsx, apps/web/e2e/admin.ts, apps/web/e2e/admin-members.spec.ts</files>
  <read_first>
    - apps/web/components/admin/AdminMemberRow.tsx lines 10-46 (MemberPills: the pill order you, role, status, and the StatusPill tones) and packages/ui/src/primitives/StatusPill.tsx (the five tones)
    - apps/web/messages/pt-BR/admin.json (the members.pills object) and apps/web/i18n/messages.test.ts (no duplicate leaf paths across catalogs)
    - apps/web/components/admin/MemberAdminSheet.test.tsx lines 1-100 (the hoisted real catalog, BASE, renderSheet(over, member)) and the sheet's use of MemberPills near line 292 of MemberAdminSheet.tsx
    - apps/web/e2e/admin-members.spec.ts lines 1-135 (throwawayMember, memberRow, the catalog-as-copy rule, the aaa-e2e- sort-first e-mails) and apps/web/e2e/admin.ts lines 69-125 (createMember, setMembershipStatus, deleteUserByEmail)
  </read_first>
  <behavior>
    - MemberPills: a member with emailUnconfirmed true and status active renders the pill with the catalog string; the same with status blocked renders both the "Bloqueado" pill and the new one; status invited renders "Convite pendente" and NOT the new pill; emailUnconfirmed false or absent renders no such pill; the viewer's own row follows the same rule; the pill order is you, role, status, then the e-mail pill; the pill tone is warning.
    - Sheet unit cases (real catalog, the string read from the loaded messages object, never a literal in the test): active + unconfirmed shows the pill inside the [data-member-pills] line; active + confirmed does not; invited + unconfirmed does not.
    - e2e: a throwaway active member made unconfirmed shows the pill on its Membros row and inside the opened sheet; a confirmed throwaway shows none; an invited unconfirmed throwaway shows "Convite pendente" and not the new pill; once the first member is confirmed again and the page reloaded, its pill is gone.
  </behavior>
  <action>
    Tests first, run red, then implement. Per request (1).

    1. Catalog: add `emailUnconfirmed` with the value "E-mail não confirmado" to the existing `admin.members.pills` object in apps/web/messages/pt-BR/admin.json (no new file, no new root key). The e2e and unit tests read this string from the catalog.
    2. apps/web/components/admin/AdminMemberRow.tsx: in MemberPills, after the status pill, push a pill with tone warning, key emailUnconfirmed and label t('members.pills.emailUnconfirmed') when `member.emailUnconfirmed === true` and `member.status !== 'invited'` (strict equality, so an older API that omits the field renders nothing). Update the component's doc comment to list the new pill and the invited exception with the reason (the invite already says the address is unverified). MemberPills is the single component used by the row and the sheet, so no other component changes; ProfileAdminTrigger renders no pills and stays untouched. Do not add the key to any member-facing component: the directory and the profile never carry the field.
    3. apps/web/components/admin/MemberAdminSheet.test.tsx: add the three unit cases from behavior beside the existing variants, using renderSheet(over, member) with an emailUnconfirmed override and reading the label from the hoisted `messages` object.
    4. apps/web/e2e/admin.ts: add and export `setEmailConfirmed(email, confirmed)` that updates auth.users.email_confirmed_at through the existing superuser connection (null when unconfirming; coalesce(email_confirmed_at, now()) when confirming) and throws when no row matched, in the file's style.
    5. apps/web/e2e/admin-members.spec.ts: add one test (its title contains the word unconfirmed so it can be selected with --grep) implementing the e2e behavior with three throwawayMember users, setEmailConfirmed, setMembershipStatus for the invited one, login as users.demoAdmin, the catalog copy A.members.pills.emailUnconfirmed / .invited, memberRow(), and the sheet's [data-member-pills] line. Follow the file's rules: throwaway members only, e-mails starting with `aaa-e2e-`, cleanup through the existing afterAll.
    6. PREREQUISITE for the e2e: the API must be listening with the Task 1 code (it reads the new function). If an API process is already running from before Task 1, restart it (`pnpm --filter @rede-social/api dev`); the local database already has the migration from Task 1.
    7. Run the verify command, then commit (explicit paths) with a message such as: feat(quick-261007-gzu): "E-mail não confirmado" pill on the Membros row and sheet.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run components/admin/MemberAdminSheet.test.tsx i18n/messages.test.ts && pnpm --filter @rede-social/web typecheck && pnpm --filter @rede-social/web lint && bash scripts/check-ui-literals.sh && SEED_PASSWORD=Segredo123 pnpm --filter @rede-social/web exec playwright test admin-members.spec.ts --project=mobile-chromium --grep "unconfirmed"</automated>
  </verify>
  <done>The unit cases, typecheck, Biome and the UI-literal check pass; the e2e shows the warning pill on the row and in the sheet for the unconfirmed member only, "Convite pendente" alone on the invited unconfirmed row, and no pill after the member is confirmed and the page reloaded; grep -c "emailUnconfirmed" apps/web/messages/pt-BR/admin.json prints 1; the admin.json value reads exactly E-mail não confirmado.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: One-time guarded backfill of existing accounts, its test and the deploy documentation</name>
  <reversibility rating="costly">Once applied to a real database a confirmation made by the backfill cannot be told apart from a genuine one; this plan only creates the file and applies it to the local stack, and the production apply is a human step after the check query in the docs.</reversibility>
  <files>supabase/migrations/*_confirm_existing_auth_emails.sql, supabase/migrations/meta/_journal.json, supabase/migrations/meta/*_snapshot.json, apps/api/tests/integration/confirm-existing-emails.test.ts, docs/deploy/auth-mail.md</files>
  <read_first>
    - supabase/migrations/20261002123247_feed_comments_orphan_replies.sql (a precedent one-off idempotent data migration and its header style)
    - apps/api/tests/integration/setup.ts (adminSql, authAdmin, removeIdentitiesByPrefix) and apps/api/tests/integration/signup.test.ts lines 1-80 (how a suite builds and cleans fixture identities)
    - docs/deploy/auth-mail.md (the Sign-up confirmation section, its Operational notes, the hosted-values section and the failure-modes table) and .github/workflows/deploy-api.yml lines 100-130 (db push runs BEFORE config push in the same job)
  </read_first>
  <behavior>
    - The shipped migration file, executed against the live local database, confirms an account that is unconfirmed, created before the cutoff and not invited (email_confirmed_at becomes non-null; the generated confirmed_at follows).
    - It leaves an unconfirmed account with invited_at set untouched, even when created before the cutoff.
    - It leaves an unconfirmed account created after the cutoff untouched (a legitimately pending sign-up, the re-run guard).
    - It leaves an already-confirmed account's email_confirmed_at exactly as it was.
    - Running the file a second time changes nothing (idempotent), for all four fixtures.
    - Fixtures are forced with fixed instants (an old created_at such as 2026-09-01 and a post-cutoff created_at of 2026-10-07 15:00:00+00), never with the wall clock, so the test is deterministic.
  </behavior>
  <action>
    Tests first, run red (the file does not exist yet), then implement. Per request (2).

    1. Write apps/api/tests/integration/confirm-existing-emails.test.ts: locate the migration by listing supabase/migrations and selecting the single file whose name ends in `_confirm_existing_auth_emails.sql` (fail loudly if there is not exactly one), read it, and execute its text with adminSql.unsafe. Build the four fixtures with authAdmin().createUser (e-mails prefixed `confirm-backfill-<random>-`, unconfirmed ones created with the confirmation flag false) and force the columns with adminSql: legacy unconfirmed (old created_at, no invited_at, email_confirmed_at null), legacy invited (old created_at, invited_at set, null), post-cutoff pending sign-up (created_at 2026-10-07 15:00:00+00, null), legacy confirmed (old created_at, a fixed email_confirmed_at). Run the file, assert the four outcomes, run it again, assert nothing changed. Clean up with removeIdentitiesByPrefix in beforeAll and afterAll and close adminSql. The suite may run while other suites create their own unconfirmed or invited users: they are all newer than the cutoff or invited, so the file cannot disturb them.
    2. Create the migration with `pnpm db:generate --custom --name=confirm_existing_auth_emails`. It holds ONE statement: an update of auth.users setting email_confirmed_at to coalesce(email_confirmed_at, now()) where email_confirmed_at is null and invited_at is null and created_at is strictly earlier than the timestamptz literal 2026-10-07 14:58:35+00. Give it a long header comment in the style of the other data migrations: WHY (sign-up e-mail confirmation, quick 261007-gbk, switches `enable_confirmations` on, and accounts created under the old autoconfirm rule, plus anything created by hand such as the platform super_admin, must not be locked out of password sign-in); ONE-TIME (it is a backfill for the moment confirmations are enabled, not a recurring job; the Supabase CLI records it as applied, but the guards below make a late or repeated run harmless anyway); the CUTOFF (the commit instant of 1bad76a, before which no legitimately pending sign-up can exist; accounts created after it are never touched, which is what protects pending sign-ups); the INVITED exclusion and its reason; IDEMPOTENT (a second run matches no row); order of application (before or with the config push that enables confirmations: deploy-api.yml already runs db push before config push in one job); that it is a data change with no schema effect, so a rollback of the API or web needs nothing; and that it is NOT applied to production or homolog by this task.
    3. Apply it to the local stack with `pnpm supabase migration up` and run the new test.
    4. Update docs/deploy/auth-mail.md (tenant terminology, no use of the word comunidade in new text): (a) in the Sign-up confirmation section's operational notes replace the bullet that says admin lists show unconfirmed members and that a badge is a follow-up: the Membros list and the member sheet now show a warning pill "E-mail não confirmado" for an active or blocked member whose address is unconfirmed, nobody is hidden, counts and filters are unchanged, the state reaches only members.manage / moderation.manage callers as a boolean read through app.membership_email_unconfirmed (tenant and membership scoped, service_role only, because neither api_user nor the admin lane can read auth.users), and an invited row keeps only "Convite pendente"; (b) add a section "Existing accounts: one-time backfill" covering what the migration does, the two guards (cutoff 2026-10-07 14:58:35+00 and invited exclusion) and why, that it is one-time and why a later run cannot confirm a pending sign-up, the order (before or with the config push that enables confirmations; in deploy-api.yml the db push step precedes the config push step; if the config is ever pushed by hand, push the migration first), a pre-flight check query for the operator to run on the target database before the config push (count of auth.users with a null email_confirmed_at, no invited_at and a created_at before the cutoff, expected 0 after the backfill), and the honest limit that accounts created by hand between the cutoff and the first production sign-up with confirmations on would not be covered; (c) add a short release-order note for the new response field: migrations first, then the web, then the API, because the web parses API answers with strict schemas (cite the Phase 8 section of docs/DEPLOY.md, which is not edited); (d) add a failure-modes row: an account that existed before reports email_not_confirmed at sign-in after the config push means the backfill was not applied, or the account is newer than the cutoff or a pending invite; fix by applying the migration, or by a one-off targeted confirm of that single account, never by removing the cutoff. Name the two new migrations by their generated file names.
    5. Run the verify command, then commit (explicit paths, including the generated meta files) with a message such as: feat(quick-261007-gzu): one-time guarded backfill confirming pre-existing accounts, with the deploy notes.
  </action>
  <verify>
    <automated>pnpm supabase migration up && pnpm --filter @rede-social/api exec vitest run tests/integration/confirm-existing-emails.test.ts && pnpm --filter @rede-social/api typecheck && pnpm --filter @rede-social/api lint && grep -v '^--' supabase/migrations/*_confirm_existing_auth_emails.sql | grep -c "created_at <" && grep -c "backfill" docs/deploy/auth-mail.md</automated>
  </verify>
  <done>The integration test passes: the legacy unconfirmed fixture ends confirmed, the invited, post-cutoff and already-confirmed fixtures are unchanged, and a second run changes nothing; the migration file's code lines (comments stripped) contain the created_at and invited_at guards; the migration, journal entry and snapshot are committed; docs/deploy/auth-mail.md documents the badge, the backfill, both guards, the ordering with the config push, the pre-flight query, the release order and the new failure mode; docs/DEPLOY.md is unmodified by this plan.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| tenant admin session -> GET /v1/admin/members | the caller's tenant is the membership of record (`requireAuth`); the permission gate decides who may read the e-mail and now its confirmation state |
| API process (admin lane, service_role) -> auth.users | GoTrue's table is unreadable to the API roles; the only bridge is one security-definer function |
| deploy operator -> production database | the backfill is a data migration that, applied wrongly or late, would confirm addresses nobody verified |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-gzu-01 | Information Disclosure | app.membership_email_unconfirmed used as a cross-tenant oracle on a user's auth state | high | mitigate | keyed by tenant AND membership, not a bare user id; the caller passes ctx.tenantId; answers false for a foreign, soft-deleted, unknown or null input; returns a boolean only (never the timestamp, e-mail or any auth column); search_path empty with fully qualified names; revoke from public and grant to service_role only; pgTAP 170 asserts the privileges and both cross-tenant negatives; the API integration suite asserts a rede-lab admin never sees a rede-demo row or state |
| T-gzu-02 | Information Disclosure | unconfirmed state reaching non-admins (members, support, the public directory) | high | mitigate | the field is added only to adminMemberSchema, served behind members.manage / moderation.manage; integration test asserts the member-facing directory answer carries no trace of it; support and plain member already get 403 on the admin list |
| T-gzu-03 | Elevation of Privilege | widening the admin lane's reach into auth.users | medium | mitigate | the function is the narrowest bridge (boolean, one membership, one tenant); no grant on auth.users is added to any role; the three alternatives that would widen it (table grant, trigger mirror, GoTrue admin call per page) are rejected in the objective |
| T-gzu-04 | Tampering | backfill confirming a legitimately pending sign-up (re-run, late apply) and so letting someone hold a membership with an address they do not own | high | mitigate | created_at cutoff at the commit instant of the sign-up confirmation code, so no pending sign-up can be older than it; invited_at exclusion; idempotent update; integration test runs the shipped file and proves a post-cutoff unconfirmed account and an invited one are untouched, twice; documented as one-time with a pre-flight query |
| T-gzu-05 | Spoofing | accounts that predate verification are confirmed without proof of address ownership | low | accept | requested explicitly; those accounts were autoconfirmed by design under Phase 1 D-04, so the backfill records the status quo rather than weakening it |
| T-gzu-06 | Repudiation | bulk confirmation leaves no per-row audit trail | low | accept | email_confirmed_at carries the migration's apply time, the file is versioned and recorded in the Supabase migration history, and the pre-flight query bounds the affected set |
| T-gzu-07 | Denial of Service | per-row security-definer call on the admin list | low | accept | at most limit+1 (51) primary-key lookups per page, the function is expensive-cost by default so Postgres evaluates it after sort and limit, and the list is admin-only |
</threat_model>

<verification>
After all three tasks, with the local stack running and the API restarted on the new code:
1. `pnpm supabase test db` green (pgTAP first, per project memory), including the new file 170.
2. `pnpm --filter @rede-social/contracts exec vitest run` and `pnpm --filter @rede-social/web exec vitest run` green.
3. `pnpm --filter @rede-social/api exec vitest run tests/integration/member-admin.test.ts tests/integration/confirm-existing-emails.test.ts tests/integration/signup.test.ts tests/integration/send-email-hook.test.ts` green (signup and hook are the gbk regression guard: a new sign-up is still unconfirmed and now shows the pill to its tenant's admin).
4. `pnpm lint` green (Biome plus the UI-literal check) and `TURBO_CACHE=local:r pnpm turbo typecheck` green.
5. `SEED_PASSWORD=Segredo123 pnpm --filter @rede-social/web exec playwright test admin-members.spec.ts --project=mobile-chromium --grep "unconfirmed"` green. The other cases of that file carry pre-existing seed-state preconditions; if one fails on residue, report it as pre-existing instead of fixing it here.
6. `test "$(git log -3 --format=%B | grep -ci 'co-authored-by')" = 0` succeeds, `git diff --cached --name-only` is empty, and `git status --short` still lists the unrelated files that were modified before this plan (MediaLibrary.tsx, the e2e specs, csp.*, docs/DEPLOY.md).
Not run, by design: the full `pnpm verify` (its e2e stage already fails on pre-existing FRONT-PENDENCIAS spec drift per STATE.md), any production or homolog apply, `supabase db push`, `supabase config push`, `db reset`.
</verification>

<success_criteria>
- A tenant admin sees "E-mail não confirmado" on every active or blocked member whose address is unconfirmed, on the row and in the sheet; nobody is hidden and no count, filter, order or page changes.
- The state reaches the API only as a boolean through one tenant-and-membership-scoped, service_role-only security-definer function; the member-facing endpoints do not carry it; cross-tenant negatives pass in pgTAP and in the API suite.
- A hand-written idempotent migration confirms pre-existing non-invited unconfirmed accounts created before the sign-up confirmation code, cannot touch a later pending sign-up or a pending invite, is proven by a test that runs the shipped file, and is applied on the local stack only.
- docs/deploy/auth-mail.md tells the operator the order (backfill before or with the config push), the pre-flight check and the field's release order.
</success_criteria>

<output>
Create `.planning/quick/261007-gzu-unconfirmed-email-tag-on-admin-member-li/261007-gzu-SUMMARY.md` when done.
</output>

## Risks

- Production data was not inspected (by instruction). If the platform super_admin hand-created on 2026-09-28 was created without Auto Confirm and has an `invited_at` value, the backfill's invited exclusion would skip it; the pre-flight query in the docs lists exactly such rows so the operator can confirm that single account deliberately.
- Deploy ordering has two independent sequences: the new response key needs migrations, then web, then API (strict web schemas); the backfill needs to be applied before or with the config push. The automated `deploy-api.yml` job already orders db push before config push, but the web release still precedes the API/config job. Both are written into docs/deploy/auth-mail.md; docs/DEPLOY.md is intentionally not edited (it carries uncommitted developer changes).
- Task 1 and Task 2 e2e depend on the API process running the new code; a stale API process would answer without the field and the pill would not appear (the optional contract hides the mismatch). The Task 2 prerequisite step says to restart it.
- The cutoff is a literal tied to one commit instant. It is correct as long as production's first pending sign-up is created after the new API ships, which holds because the old API autoconfirms; it would be wrong only if someone created unconfirmed accounts by hand before 2026-10-07 14:58:35+00 and wants them covered, which is exactly what a targeted one-off confirm is for.

## Coverage audit (quick task, no ROADMAP phase; source = the request text)

| Source item (request) | Covered by |
|---|---|
| (1) do NOT hide unconfirmed members in the tenant admin's list, show them normally | Task 1 (no filter added; integration asserts they stay in Todos/Ativos and the list equals listSnapshot), Task 2 |
| (1) pt-BR badge "E-mail não confirmado", next-intl catalog, existing badge pattern | Task 2 (admin.members.pills.emailUnconfirmed, StatusPill warning in MemberPills) |
| (1) derived from auth.users.email_confirmed_at is null, expose only a boolean | Task 1 (function returns boolean; contract carries a boolean) |
| (1) respect tenant isolation / RLS / admin role | Task 1 (function scoped by tenant and membership, ctx.tenantId passed, readGuard unchanged), pgTAP + API cross-tenant negatives |
| (1) work out how api_user (NOBYPASSRLS) can read auth.users.email_confirmed_at safely, least privilege, cross-tenant negative test | Objective (probe result and rejected alternatives), Task 1 migration + pgTAP 170 + integration |
| (1) counts stay as they are | Task 1 integration (length and order equal listSnapshot), no count query touched |
| (1) check whether member detail / other admin lists need it, keep scope tight | Member sheet and profile trigger covered with no extra work (shared projection and MemberPills); out of scope by decision: member-facing directory/profile (privacy), platform AdminsCard and invites (the invite state is the state), moderation log (no member state) |
| (2) Supabase migration, new timestamp, idempotent, hand-written SQL per the --custom convention, only where null | Task 3 steps 2-3 |
| (2) cover with a pgTAP test if it fits | Does not fit (pgTAP cannot load a migration file from inside the DB container, and a copied statement would not test the shipped SQL); replaced by a Vitest integration test that executes the real file (Task 3 step 1). The pgTAP suite still runs first in verification |
| (2) do NOT apply to production/homolog, no db push, only local | Task 3 steps 2-3, context rules, Verification "not run" list |
| (2) must not confirm legitimately pending new sign-ups; document in the plan and auth-mail.md; guard if cheap | Objective (cutoff guard, invited guard), Task 3 migration header + test + docs step 4 |
| (2) apply BEFORE/with the config push; one-time backfill, re-run hazard | Task 3 docs step 4(b), Risks |
| Terminology: tenant, never comunidade | Objective, Task 3 docs step 4 |
| Commits carry no Co-Authored-By/Claude attribution | Context rules, Verification 6 |
| Use TURBO_CACHE=local:r in any gate command | Context rules, Verification 4 |
| Deferred / out of scope | filter or search by unconfirmed; an admin action to resend the confirmation mail; showing the state to members; editing docs/DEPLOY.md; any production apply |
