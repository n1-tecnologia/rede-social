-- multi_tenant_identity_lookups (08.1-01, V2-PLAT-07, D-307, D-304, D-308) — the two membership
-- lookups requireAuth runs once an identity may hold one membership in each of several tenants. Its
-- companion `20261006195908_multi_tenant_identity.sql` is the GENERATED half (it drops
-- `memberships_one_tenant_per_user_v1`); this file is what drizzle-kit cannot model.
--
-- ── WHY TWO FUNCTIONS, AND WHY THE HOST PICKS ───────────────────────────────────────────────────────
-- * `app.membership_in_tenant(user, tenant)` is the tenant-host path (D-307): the browser-facing host
--   resolves to ONE verified tenant, and the request's membership is the user's non-deleted row in
--   THAT tenant and nothing else. No row means TENANT_HOST_MISMATCH: the host selects among the
--   user's own memberships and grants nothing (D-23).
-- * `app.memberships_of_user(user)` is the generic-host path (localhost, Vercel Preview, the platform
--   host, no header — D-308, D-06): every non-deleted membership, and the API's pure
--   `pickGenericMembership` decides (a choice header naming one of them, a single row, …).
-- Both evaluate block and suspension on the row they return, so a block or suspension in tenant A
-- never reaches the identity's requests on tenant B's host (D-304).
--
-- ── WHY NO ROW CAP ──────────────────────────────────────────────────────────────────────────────────
-- `membership_in_tenant` returns at most one row because `memberships_tenant_user_uq` is unique on
-- `(tenant_id, user_id)`; a `limit 1` would only hide a broken invariant. `memberships_of_user` must
-- return EVERY row; its `order by t.slug` is a deterministic display order for the 08.1-03 picker,
-- never a pick-one rule.
--
-- ── WHY THE OLD FUNCTION STAYS (expand step of D-318) ───────────────────────────────────────────────
-- `app.membership_for_user` (`order by joined_at limit 1`) is left byte-for-byte unchanged: the
-- production deploy runs `supabase db push` BEFORE the new Cloud Run revision, so the revision still
-- serving during the push keeps calling it. It is dropped by the contract migration of 08.1-08.
--
-- ── LIFECYCLE (the WR-08 rule, unchanged) ───────────────────────────────────────────────────────────
-- `deleted_at is not null` -> no row; `blocked_at is not null` -> reported as 'blocked' whatever the
-- `status` column says; otherwise the stored status. These rules live here and nowhere else.
--
-- ── HARDENING ───────────────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER with `search_path = ''` and fully qualified names: requireAuth runs before any
-- lane exists, on the bare `api_user` connection, which may only EXECUTE these. `revoke all … from
-- public` then `grant execute … to api_user` only; the tenant lane (`authenticated`) cannot call them.
-- `app` is not a PostgREST-exposed schema. Proved by `supabase/tests/040-schema-conventions.sql`.

create or replace function app.membership_in_tenant(p_user_id uuid, p_tenant_id uuid)
returns table (
  tenant_id uuid,
  tenant_slug text,
  tenant_display_name text,
  role text,
  status text,
  tenant_status text
)
language sql stable security definer set search_path = '' as $$
  select m.tenant_id,
         t.slug,
         t.display_name,
         m.role,
         case when m.blocked_at is not null then 'blocked' else m.status end,
         t.status
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id
    and m.tenant_id = p_tenant_id
    and m.deleted_at is null
$$;
--> statement-breakpoint
revoke all on function app.membership_in_tenant(uuid, uuid) from public;
--> statement-breakpoint
grant execute on function app.membership_in_tenant(uuid, uuid) to api_user;
--> statement-breakpoint
create or replace function app.memberships_of_user(p_user_id uuid)
returns table (
  tenant_id uuid,
  tenant_slug text,
  tenant_display_name text,
  role text,
  status text,
  tenant_status text
)
language sql stable security definer set search_path = '' as $$
  select m.tenant_id,
         t.slug,
         t.display_name,
         m.role,
         case when m.blocked_at is not null then 'blocked' else m.status end,
         t.status
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id
    and m.deleted_at is null
  order by t.slug
$$;
--> statement-breakpoint
revoke all on function app.memberships_of_user(uuid) from public;
--> statement-breakpoint
grant execute on function app.memberships_of_user(uuid) to api_user;
