-- membership_email_unconfirmed (quick 261007-gzu) — one fact about a membership of one tenant: is the
-- e-mail of its identity still unconfirmed? Custom migration (drizzle-kit cannot model a function
-- over `auth.users`).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────
-- Request (1): the tenant admin's Membros list keeps showing a member whose e-mail is unconfirmed (a
-- sign-up still waiting for its mail, quick 261007-gbk), now with a pt-BR badge "E-mail não
-- confirmado". The fact is `auth.users.email_confirmed_at is null`, and only a boolean may leave the
-- database.
--
-- ── WHY A FUNCTION (verified on the live local stack) ───────────────────────────────────────────────
-- Neither `api_user` nor the admin lane (`service_role`, which serves the member list through
-- `withAdminTx`) holds SELECT on `auth.users`, so a join in the list query is impossible. The repo's
-- least-privilege pattern for this is `app.identity_has_password`: SECURITY DEFINER, empty
-- search_path, a boolean. This function follows it but is keyed by TENANT AND MEMBERSHIP, not by a bare
-- user id: a user-id-keyed boolean would be a cross-tenant oracle on a person's auth state (anyone
-- able to call it could probe any identity). Rejected alternatives:
--   * a scalar keyed by user id — no tenant scope, the oracle above;
--   * mirroring `email_confirmed_at` into `public.users` with a trigger — a trigger on a GoTrue-owned
--     table that fires on every sign-in update, a stale-state risk, and a new column on a core table;
--   * a GoTrue admin API call per page — N HTTP calls and the service key inside a read path.
--
-- ── CALLER ──────────────────────────────────────────────────────────────────────────────────────────
-- `packages/core/server/tenancy/admin-members.ts` calls it inside `withAdminTx` (service_role) with
-- `ctx.tenantId` (the membership of record from `requireAuth`, NOT the row's tenant_id) and the row's
-- membership id. If a future edit ever dropped the `m.tenant_id` predicate, another tenant's row would
-- read false instead of leaking.
--
-- ── HARDENING ───────────────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER with `search_path = ''` and fully qualified names. It returns a BOOLEAN only —
-- never the timestamp, the e-mail or any auth column — for exactly one membership of exactly one
-- tenant. A membership of another tenant, a soft-deleted membership, an unknown id and a null argument
-- all answer false (coalesce), never null and never an error. `revoke all … from public`, then execute
-- for `service_role` ONLY (the admin lane is the single caller): no grant to `api_user`,
-- `authenticated` or `anon`. `app` is not a PostgREST-exposed schema. Proved by
-- `supabase/tests/170-membership-email-unconfirmed.sql`.
--
-- ── RELEASE ORDER ───────────────────────────────────────────────────────────────────────────────────
-- Expand-only: a new function, nothing altered or dropped, so the API revision still serving during
-- `supabase db push` is unaffected.

create or replace function app.membership_email_unconfirmed(p_tenant_id uuid, p_membership_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select u.email_confirmed_at is null
       from public.memberships m
       join auth.users u on u.id = m.user_id
      where m.id = p_membership_id
        and m.tenant_id = p_tenant_id
        and m.deleted_at is null),
    false
  )
$$;
--> statement-breakpoint
revoke all on function app.membership_email_unconfirmed(uuid, uuid) from public;
--> statement-breakpoint
grant execute on function app.membership_email_unconfirmed(uuid, uuid) to service_role;
