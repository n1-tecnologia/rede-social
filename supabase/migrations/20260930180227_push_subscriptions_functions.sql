-- push_subscriptions_functions (07-06, NOTIF-03) — the ONLY writers of `public.push_subscriptions` and the
-- worker's only reader. Its companion `*_push_subscriptions.sql` is the GENERATED half (the table, its
-- tenant-first indexes and its owner-only select/delete policies; there is NO insert and NO update policy).
--
-- WHY SECURITY DEFINER. A member saves a device through the API, which runs in the member's own tenant
-- lane: an owner-scoped INSERT policy would work for the insert, but the device HANDOFF (T-07-34) needs
-- to delete ANOTHER member's row with the same endpoint, which the owner-only policy (correctly) hides.
-- The worker's push-send job runs in the notifications system lane (the zero user), which the owner-only
-- policies show no row at all, so it reads and reports through narrow definers too (RESEARCH Pattern 12:
-- "prefer the definer, explicit and testable").
--
-- PITFALL 2 (the check-in and fan-out precedent): the owner is `postgres`, which has `rolbypassrls`. RLS
-- protects NOTHING in here, so every statement scopes `tenant_id` to `app.tenant_id()` itself, and a lane
-- without a tenant claim is refused (42501). A forged tenant id in a push-send job can therefore only
-- read, report or delete THAT tenant's subscriptions (T-07-41). `supabase/tests/153-push-subscriptions.sql`
-- proves the scoping with cross-tenant fixtures and positive controls.
--
-- THE LIVE PREDICATE (the fan-out's, D-229): `status = 'active'`, `blocked_at is null`, `deleted_at is
-- null`, within the caller's tenant, of any role (a staff member's device receives the personal kinds).
--
-- Hardening: `set search_path = ''`, fully qualified names, `#variable_conflict use_column` where an OUT
-- column shares a table column's name, `revoke all … from public`, `grant execute … to authenticated`
-- only. `app` is not a PostgREST-exposed schema, so none of this is RPC-reachable. No function here
-- silently picks one row (pgTAP 040's convention).

-- ── app.push_subscription_upsert ──────────────────────────────────────────────────────────────────────
-- The member's own save (`POST /v1/notifications/push-subscriptions`). Requires `app.user_id()` and a
-- LIVE membership of the caller in the claim's tenant (a blocked member cannot re-arm a device). Any row
-- of the same endpoint in the tenant that belongs to ANOTHER user is deleted first (the device changed
-- hands: A's pushes stop, T-07-34); then the caller's row is inserted, or refreshed in place when the
-- caller already owns the endpoint (a key rotation keeps its id). The conflict branch also rewrites
-- `user_id`, so two concurrent saves of one endpoint by different users still leave exactly one owner.
-- Returns the row id. The API validated the endpoint (https + known push-service host) and the key
-- lengths before calling; the `https://` check here is defence in depth.
create or replace function app.push_subscription_upsert(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text
)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_id uuid;
begin
  if v_t is null or v_u is null then
    raise exception 'push_subscription_upsert: refused' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.memberships m
     where m.tenant_id = v_t
       and m.user_id = v_u
       and m.status = 'active'
       and m.blocked_at is null
       and m.deleted_at is null
  ) then
    raise exception 'push_subscription_upsert: refused' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint not like 'https://%'
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'push_subscription_upsert: invalid subscription' using errcode = '22023';
  end if;

  delete from public.push_subscriptions s
   where s.tenant_id = v_t
     and s.endpoint = p_endpoint
     and s.user_id <> v_u;

  insert into public.push_subscriptions as s (tenant_id, user_id, endpoint, p256dh, auth, user_agent)
  values (v_t, v_u, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 512))
  on conflict (tenant_id, endpoint) do update
     set user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         failure_count = 0
  returning s.id into v_id;

  return v_id;
end
$$;
--> statement-breakpoint
revoke all on function app.push_subscription_upsert(text, text, text, text) from public;--> statement-breakpoint
grant execute on function app.push_subscription_upsert(text, text, text, text) to authenticated;--> statement-breakpoint

-- ── app.push_subscriptions_for ────────────────────────────────────────────────────────────────────────
-- The worker's read (`notifications.push-send`, and the push adapter's "who has a device" filter): every
-- subscription of the LISTED users whose membership in the claim's tenant is live, with that membership's
-- role (the job opens each recipient's badge lane with it). A listed user of another tenant, or a blocked
-- or departed one, contributes nothing.
create or replace function app.push_subscriptions_for(p_user_ids uuid[])
returns table (id uuid, user_id uuid, role text, endpoint text, p256dh text, auth text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
begin
  if v_t is null then
    raise exception 'push_subscriptions_for: refused' using errcode = '42501';
  end if;

  return query
  select s.id, s.user_id, m.role::text, s.endpoint, s.p256dh, s.auth
    from public.push_subscriptions s
    join public.memberships m
      on m.tenant_id = s.tenant_id
     and m.user_id = s.user_id
   where s.tenant_id = v_t
     and s.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null
   order by s.user_id, s.created_at, s.id;
end
$$;
--> statement-breakpoint
revoke all on function app.push_subscriptions_for(uuid[]) from public;--> statement-breakpoint
grant execute on function app.push_subscriptions_for(uuid[]) to authenticated;--> statement-breakpoint

-- ── app.push_subscriptions_delete_dead ────────────────────────────────────────────────────────────────
-- Roadmap SC 4: a member who is no longer live in the tenant (blocked, soft-deleted, not active, or with
-- no membership at all) loses every device, and is never pushed. Deletes the subscriptions of the LISTED
-- users whose membership in the claim's tenant is missing or not live; live members' rows stay.
--
-- `p_user_ids` NULL means EVERY subscription of the tenant (07-06 deviation): a broadcast fan-out lists
-- only the recipients `in_app` newly wrote, and the fan-out's live predicate has already removed a blocked
-- member from that list, so a per-listed-user sweep could never see them. The push adapter therefore
-- sweeps the whole tenant before a `members` broadcast; the send job sweeps its own listed users again
-- just before sending (the member may have been blocked in between). Phase 8's block action can call it
-- eagerly with the blocked user's id. Returns how many rows were deleted.
create or replace function app.push_subscriptions_delete_dead(p_user_ids uuid[])
returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
  v_n int;
begin
  if v_t is null then
    raise exception 'push_subscriptions_delete_dead: refused' using errcode = '42501';
  end if;

  delete from public.push_subscriptions s
   where s.tenant_id = v_t
     and (p_user_ids is null or s.user_id = any(p_user_ids))
     and not exists (
       select 1
         from public.memberships m
        where m.tenant_id = s.tenant_id
          and m.user_id = s.user_id
          and m.status = 'active'
          and m.blocked_at is null
          and m.deleted_at is null
     );
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
--> statement-breakpoint
revoke all on function app.push_subscriptions_delete_dead(uuid[]) from public;--> statement-breakpoint
grant execute on function app.push_subscriptions_delete_dead(uuid[]) to authenticated;--> statement-breakpoint

-- ── app.push_subscription_report ──────────────────────────────────────────────────────────────────────
-- The send job's outcome for ONE subscription of the claim's tenant: `sent` (201/202) stamps
-- `last_success_at` and resets `failure_count`; `gone` (404/410, the endpoint expired) deletes the row;
-- `failed` (400/413/429/5xx/network) increments `failure_count`. Any other outcome raises (22023). An id
-- of another tenant, or one already deleted, touches nothing.
create or replace function app.push_subscription_report(p_id uuid, p_outcome text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
begin
  if v_t is null then
    raise exception 'push_subscription_report: refused' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('sent', 'gone', 'failed') then
    raise exception 'push_subscription_report: unknown outcome' using errcode = '22023';
  end if;

  if p_outcome = 'sent' then
    update public.push_subscriptions s
       set last_success_at = now(), failure_count = 0
     where s.tenant_id = v_t and s.id = p_id;
  elsif p_outcome = 'gone' then
    delete from public.push_subscriptions s
     where s.tenant_id = v_t and s.id = p_id;
  else
    update public.push_subscriptions s
       set failure_count = s.failure_count + 1
     where s.tenant_id = v_t and s.id = p_id;
  end if;
end
$$;
--> statement-breakpoint
revoke all on function app.push_subscription_report(uuid, text) from public;--> statement-breakpoint
grant execute on function app.push_subscription_report(uuid, text) to authenticated;
