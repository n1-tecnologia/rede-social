-- push_devices_cut_members (09.1-12, PAY-17, D-498; flagged assumption P36) — a member whose subscription
-- is not active forgets their push devices.
-- Hand-written (`--custom`), sorted AFTER `*_access_gate_functions.sql` (09.1-02), whose
-- `app.access_cut_user_ids(uuid)` and `app.membership_access_cut(uuid, uuid)` it calls.
--
-- WHY. D-498 says a cut member receives no push, and 09.1-12's subscriber to `membership.access_cut`
-- asks `app.push_subscriptions_delete_dead(array[userId])` to forget their devices. That definer
-- (`*_push_subscriptions_functions.sql`, 07-06) deletes the devices of a member who is "no longer live"
-- (blocked, soft-deleted or not active), and a CUT member is none of those: a cut never writes the
-- membership (D-496, PR-3). Left as it was the cleanup would delete nothing for the one person it was
-- written for, and the send job's own pre-send sweep would keep pushing to a cut member.
--
-- WHAT. One `create or replace` of that definer, same signature (`uuid[]` in, `int` out), same
-- language, volatility, definer, empty search_path and ACLs, same tenant pinning, same `null` meaning
-- "every subscription of the tenant". It gains ONE more reason a device is dead: its owner's access is
-- cut. The cut set among the listed users is read ONCE per call, never per device:
--   * listed users: `app.membership_access_cut(tenant, user)` for each listed id;
--   * `null` (the broadcast path): `app.access_cut_user_ids(tenant)`.
-- Both answer an empty set while the gate is off or `payments` is disabled, and never name staff
-- (D-492), so a tenant without the gate gets byte for byte what it got before.
--
-- DEPLOY. Expand-only: `create or replace` with an identical signature, so the previous API revision
-- keeps working during `supabase db push`. A member returned by a renewal has no device until their
-- browser subscribes again, which it does on the next open (the same as after any dead-device sweep).

create or replace function app.push_subscriptions_delete_dead(p_user_ids uuid[])
returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
  v_cut uuid[];
  v_n int;
begin
  if v_t is null then
    raise exception 'push_subscriptions_delete_dead: refused' using errcode = '42501';
  end if;

  -- The users whose subscription is cut, read once.
  if p_user_ids is null then
    v_cut := app.access_cut_user_ids(v_t);
  else
    select coalesce(array_agg(u.id), '{}'::uuid[])
      into v_cut
      from (select distinct unnest(p_user_ids) as id) u
     where app.membership_access_cut(v_t, u.id);
  end if;

  delete from public.push_subscriptions s
   where s.tenant_id = v_t
     and (p_user_ids is null or s.user_id = any(p_user_ids))
     and (
       s.user_id = any(v_cut)
       or not exists (
         select 1
           from public.memberships m
          where m.tenant_id = s.tenant_id
            and m.user_id = s.user_id
            and m.status = 'active'
            and m.blocked_at is null
            and m.deleted_at is null
       )
     );
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
--> statement-breakpoint
revoke all on function app.push_subscriptions_delete_dead(uuid[]) from public;--> statement-breakpoint
grant execute on function app.push_subscriptions_delete_dead(uuid[]) to authenticated;
