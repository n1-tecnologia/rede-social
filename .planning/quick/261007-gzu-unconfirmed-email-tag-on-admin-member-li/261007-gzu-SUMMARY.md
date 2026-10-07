---
phase: quick-261007-gzu
plan: 01
subsystem: auth, admin-members
tags: [auth, email-verification, admin-members, security-definer, backfill, pgtap, pt-BR]
requirements: [ADMIN-02, AUTH-02, TENANT-05]
status: complete
plan_head_before: ec9f73fa8f0dd2cdca8bb78eff76e414a3acd882
commits: 3
requires:
  - quick-261007-gbk (sign-up e-mail verification)
provides:
  - app.membership_email_unconfirmed(uuid, uuid): tenant-and-membership scoped boolean over auth.users
  - AdminMember.emailUnconfirmed (optional boolean) on GET /v1/admin/members and /{membershipId}
  - "E-mail não confirmado" warning pill on the Membros row and the member sheet
  - one-time guarded backfill migration confirming pre-existing accounts
tech-stack:
  patterns: [security-definer boolean bridge over a GoTrue-owned table, optional strict-schema field for expand/contract release order]
key-files:
  created:
    - supabase/migrations/20261007152755_membership_email_unconfirmed.sql
    - supabase/migrations/20261007153044_confirm_existing_auth_emails.sql
    - supabase/migrations/meta/20261007152755_snapshot.json
    - supabase/migrations/meta/20261007153044_snapshot.json
    - supabase/tests/170-membership-email-unconfirmed.sql
    - apps/api/tests/integration/confirm-existing-emails.test.ts
  modified:
    - supabase/migrations/meta/_journal.json
    - packages/contracts/src/moderation.ts
    - packages/contracts/tests/moderation.test.ts
    - packages/core/server/tenancy/admin-members.ts
    - apps/api/src/routes/admin/members.ts
    - apps/api/tests/integration/member-admin.test.ts
    - apps/web/components/admin/AdminMemberRow.tsx
    - apps/web/components/admin/MemberAdminSheet.test.tsx
    - apps/web/messages/pt-BR/admin.json
    - apps/web/e2e/admin.ts
    - apps/web/e2e/admin-members.spec.ts
    - docs/deploy/auth-mail.md
decisions:
  - "Read path is a SECURITY DEFINER function keyed by tenant AND membership, granted to service_role only; the projection passes ctx.tenantId, never the row's tenant_id"
  - "emailUnconfirmed is optional in the strict contract; release order is migrations, then web, then API"
  - "Invited rows hide the new pill in the UI (Convite pendente already says the address is unverified); the API reports the raw fact"
  - "Backfill guarded by created_at < 2026-10-07 14:58:35+00 and invited_at is null; the second guard goes one step beyond the literal request"
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
duration: ~25 min
completed: 2026-10-07
---

# Quick 261007-gzu: Unconfirmed e-mail tag on the admin member list, plus the existing-accounts backfill

A tenant admin now sees "E-mail não confirmado" on every active or blocked member whose address is unconfirmed (Membros row and member sheet), fed by a boolean-only, tenant-scoped security-definer function; and a guarded, idempotent migration confirms accounts that predate the sign-up confirmation code.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 0ec4e5e | `app.membership_email_unconfirmed`, pgTAP 170, `adminMemberSchema.emailUnconfirmed`, kernel projection, route descriptions, contract and integration tests |
| 2 | 972ce9e | pill in `MemberPills`, catalog string, sheet unit cases, `setEmailConfirmed` e2e helper, e2e |
| 3 | 54c37b9 | backfill migration, test that executes the shipped file, `docs/deploy/auth-mail.md` |

## What was built

- **Function.** `app.membership_email_unconfirmed(p_tenant_id, p_membership_id) returns boolean`, SECURITY DEFINER, `search_path = ''`, `revoke all from public`, execute for `service_role` only. A foreign tenant, a soft-deleted membership, an unknown id and null arguments answer false. The projection calls it with `ctx.tenantId`. No filter, no query parameter, no change to ordering, cursor or counts.
- **Contract.** `emailUnconfirmed: z.boolean().optional()` on the strict `adminMemberSchema`; absent means an API that predates the field.
- **UI.** Warning pill after the status pill, shown only when `emailUnconfirmed === true` and `status !== 'invited'`; the copy lives in `admin.members.pills.emailUnconfirmed`. The directory and profile carry no trace of the field (integration test).
- **Backfill.** One `update auth.users` statement guarded by `email_confirmed_at is null`, `invited_at is null` and `created_at < timestamptz '2026-10-07 14:58:35+00'`. Applied to the LOCAL stack only (it matched 0 rows locally: no unconfirmed identity existed at that moment).
- **Docs.** `docs/deploy/auth-mail.md`: badge, backfill and both guards, order with the config push (db push precedes config push in `deploy-api.yml`), pre-flight query, honest limit, release order of the new field, new failure-mode row. `docs/DEPLOY.md` untouched.

## Verification (real results)

- `pnpm supabase test db`: file 170 passes (19/19). File `154-moderation-log.sql` fails test 28 ("every log row is anchored to two memberships of its own tenant"). It failed identically in the first run, before any change of mine, and is the documented integration-residue trip; it is unrelated to this work and was not touched.
- `vitest`: contracts 133/133, web 2010/2010 (101 files), API `member-admin` + `confirm-existing-emails` + `signup` + `send-email-hook` 88/88.
- `TURBO_CACHE=local:r pnpm turbo typecheck` 16/16 successful; `pnpm lint` (Biome plus UI-literal check) green.
- e2e: `SEED_PASSWORD=Segredo123 playwright test admin-members.spec.ts --project=mobile-chromium --grep "unconfirmed"` 1 passed (pill on the row and in the sheet; none on the confirmed or invited row; gone after confirming and reloading). Playwright started its own API and web servers (none was running), so the API ran the new code. The other cases of that spec file were not run.
- Commits carry no Co-Authored-By trailer; nothing staged afterwards; the pre-existing unrelated modified files are still modified and uncommitted.

## Deviations from Plan

None needing a rule. Two notes:

- Red-first was observed for pgTAP 170 (function missing), the sheet unit cases and the backfill test (migration file missing). For the contract cases and the new `member-admin` integration describe I wrote the tests first but did not run them red before the implementation; they pass now.
- Fixture e-mails in the new integration describe use the `ue-` prefix because `convidado-${RUN}` already exists in the same file (first run collided; renamed).

## Items to flag

- The `invited_at is null` guard goes one step beyond the literal request (a one-line removal if undesired). Consequence: a hand-made production account that carries an `invited_at` is skipped by the backfill; the pre-flight query in the docs lists such rows.
- Release order for the new response field: migrations, then web, then API (the old web's strict schema refuses an unknown key).
- Nothing was deployed or pushed; no `db push`, `config push`, `db reset`, production or homolog access.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register (T-gzu-01..07 are mitigated as planned: cross-tenant negatives in pgTAP 170 and in the API suite, privacy assertion on the member directory, backfill guards proved by running the shipped file twice).

## Self-Check: PASSED

Files and commits checked: the six created files exist, and 0ec4e5e, 972ce9e, 54c37b9 are in `git log`.
