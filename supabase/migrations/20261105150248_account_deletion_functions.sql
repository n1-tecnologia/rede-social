-- account_deletion_functions (Phase 13, NATIVE-19..21; D-609, D-610; T-13-13, T-13-14, T-13-15) — the rules of
-- "Excluir minha conta". Hand-written (`--custom`): drizzle-kit cannot model functions. Its companion
-- `*_account_deletion.sql` is the GENERATED half (the four `memberships` columns and `memberships_deletion_chk`);
-- this file is sorted AFTER it and calls nothing it does not create.
--
-- THE MODEL (D-610). A member's own request REUSES the soft state: `deleted_at = now()`. Every live-member filter
-- already shipped (lists, counters, fan-out, push, requireAuth) therefore deactivates the member with no new
-- predicate. `deletion_requested_at` is the marker that tells a member's own request from a moderation
-- soft-delete: `app.account_deletion_cancel` restores ONLY a row that carries it. `deletion_due_at` is
-- `deletion_requested_at + interval '14 days'`, computed once here on `timestamptz` (microsecond precision, no
-- rounding) and stored; the database never stores a local date. After the deadline the anonymisation
-- (`app.account_anonymise`, below the cancel) erases the personal data IN PLACE and never deletes a content row
-- (D-609): the membership row stays so every author foreign key holds.
--
-- SQLSTATE. `42501` refused (no claim, no live membership); `AD001` the caller is the only active
-- `admin_tenant` (plan 13 maps it to `LAST_ADMIN`).
--
-- The conventions of `20260930180227_push_subscriptions_functions.sql` carry over: `security definer`,
-- `set search_path = ''`, fully qualified names, tenant scope in EVERY statement (the owner is `postgres`, which
-- has `rolbypassrls`, so RLS protects nothing in here), `revoke all … from public`. `app` is not a
-- PostgREST-exposed schema, so none of this is RPC-reachable.

-- ── app.account_deletion_request ──────────────────────────────────────────────────────────────────────
-- The caller's OWN request, derived only from the claims (T-13-13: there is no administrator variant). The
-- caller's membership is locked `for update`; an `admin_tenant` locks the tenant's whole active-admin set in id
-- order BEFORE anything else (the `lockAdminsAndTarget` precedent in member-admin.ts, and the same order for
-- every admin, so two admins deleting at once cannot deadlock) and is refused with AD001 when no OTHER admin
-- is active, unblocked and not deleted. Idempotent: a second call returns the SAME deadline and rewrites nothing.
create or replace function app.account_deletion_request()
returns timestamptz
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_role text;
  v_m public.memberships%rowtype;
  v_due timestamptz;
begin
  if v_t is null or v_u is null then
    raise exception 'account_deletion_request: refused' using errcode = '42501';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.tenant_id = v_t and m.user_id = v_u;
  if not found then
    raise exception 'account_deletion_request: refused' using errcode = '42501';
  end if;

  if v_role = 'admin_tenant' then
    perform 1
      from public.memberships a
     where a.tenant_id = v_t
       and (
         a.user_id = v_u
         or (a.role = 'admin_tenant' and a.status = 'active' and a.blocked_at is null and a.deleted_at is null)
       )
     order by a.id
       for update;
  else
    perform 1
      from public.memberships a
     where a.tenant_id = v_t and a.user_id = v_u
       for update;
  end if;

  select m.* into v_m
    from public.memberships m
   where m.tenant_id = v_t and m.user_id = v_u;

  -- Already requested (a retry, or a second device): the same deadline, nothing rewritten.
  if v_m.deletion_requested_at is not null then
    return v_m.deletion_due_at;
  end if;

  if v_m.status <> 'active' or v_m.blocked_at is not null or v_m.deleted_at is not null then
    raise exception 'account_deletion_request: refused' using errcode = '42501';
  end if;

  if v_m.role = 'admin_tenant' and not exists (
    select 1
      from public.memberships a
     where a.tenant_id = v_t
       and a.id <> v_m.id
       and a.role = 'admin_tenant'
       and a.status = 'active'
       and a.blocked_at is null
       and a.deleted_at is null
  ) then
    raise exception 'account_deletion_request: last administrator' using errcode = 'AD001';
  end if;

  v_due := now() + interval '14 days';
  update public.memberships m
     set deleted_at = now(),
         deletion_requested_at = now(),
         deletion_due_at = v_due,
         deletion_cancelled_until = null
   where m.id = v_m.id and m.tenant_id = v_t;
  return v_due;
end
$$;
--> statement-breakpoint
revoke all on function app.account_deletion_request() from public;--> statement-breakpoint
grant execute on function app.account_deletion_request() to authenticated;--> statement-breakpoint

-- ── app.account_deletion_cancel ───────────────────────────────────────────────────────────────────────
-- The cancel by a fresh sign-in. Called by the API BEFORE a tenant claim exists (the sign-in found no live
-- membership), so the tenant and the user are parameters and the function is executable by the connection role
-- and `service_role` only (T-13-14). The row is locked `for update` and the deadline is re-checked UNDER the
-- lock, so a cancel racing the anonymisation (which takes the same lock and re-checks the same deadline)
-- resolves to exactly one outcome. It restores ONLY a row that carries the member's own marker, only while
-- `deletion_due_at > now()` (at the deadline instant it is refused) and only for a token issued AFTER the
-- request (`p_token_iat > deletion_requested_at`): a session token valid before the request can never undo it.
-- The previous deadline is parked in `deletion_cancelled_until` for `app.account_deletion_notice_take`.
create or replace function app.account_deletion_cancel(p_tenant uuid, p_user uuid, p_token_iat timestamptz)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_m public.memberships%rowtype;
begin
  if p_tenant is null or p_user is null or p_token_iat is null then
    return false;
  end if;

  select m.* into v_m
    from public.memberships m
   where m.tenant_id = p_tenant and m.user_id = p_user
     for update;
  if not found then
    return false;
  end if;

  if v_m.deletion_requested_at is null
     or v_m.anonymised_at is not null
     or v_m.deletion_due_at <= now()
     or p_token_iat <= v_m.deletion_requested_at then
    return false;
  end if;

  update public.memberships m
     set deleted_at = null,
         deletion_requested_at = null,
         deletion_due_at = null,
         deletion_cancelled_until = v_m.deletion_due_at
   where m.id = v_m.id and m.tenant_id = p_tenant;
  return true;
end
$$;
--> statement-breakpoint
revoke all on function app.account_deletion_cancel(uuid, uuid, timestamptz) from public, anon, authenticated;--> statement-breakpoint
grant execute on function app.account_deletion_cancel(uuid, uuid, timestamptz) to service_role, api_user;--> statement-breakpoint

-- ── app.account_deletion_notice_take ──────────────────────────────────────────────────────────────────
-- The member's notice after a cancel ("Exclusão cancelada", the bootstrap's `pendingDeletion`): returns the
-- parked deadline ONCE and clears it in the same statement. Scoped to the caller's LIVE membership in the
-- claim's tenant; anyone else gets null and nothing changes.
create or replace function app.account_deletion_notice_take()
returns timestamptz
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_due timestamptz;
begin
  if v_t is null or v_u is null then
    raise exception 'account_deletion_notice_take: refused' using errcode = '42501';
  end if;

  with old as (
    select m.id, m.deletion_cancelled_until as due
      from public.memberships m
     where m.tenant_id = v_t
       and m.user_id = v_u
       and m.status = 'active'
       and m.blocked_at is null
       and m.deleted_at is null
       and m.deletion_cancelled_until is not null
       for update
  )
  update public.memberships m
     set deletion_cancelled_until = null
    from old
   where m.id = old.id and m.tenant_id = v_t
  returning old.due into v_due;

  return v_due;
end
$$;
--> statement-breakpoint
revoke all on function app.account_deletion_notice_take() from public;--> statement-breakpoint
grant execute on function app.account_deletion_notice_take() to authenticated;
