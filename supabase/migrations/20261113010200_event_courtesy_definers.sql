-- event_courtesy_definers (Phase 10.1, plan 04; TICK-04, TICK-07, TICK-08, TICK-10, TICK-14, TICK-21; D-741,
-- D-743, D-747, D-750, D-751, D-753; A-UI-5; T-10.1-01, T-10.1-12, T-10.1-15). Hand-written (`--custom`),
-- applied after `*_event_gateway_grant_revoke.sql` in this plan.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────────
-- The admin's side of a paid event, as five tenant-lane definers modelled on `app.store_grant`
-- (`20261008190514_store_grants.sql`): the second of the only two ways to a presence (D-741: the gateway
-- pair is the first), the lock and the reset the mapping service needs (D-747), and the read the release
-- sheet needs (D-753). The member lane has no privilege to write a courtesy, a ticket or an order
-- reference (the policies of plan 02 pin `origin = 'rsvp'`), so the admin needs a definer, and the
-- `admin_tenant` claim is checked INSIDE each function, whatever route reached it (T-10.1-12).
--
-- ── OUTCOMES (RETURNED, never raised) ────────────────────────────────────────────────────────────────
--   app.event_courtesy_grant(p_event, p_membership) returns (outcome)
--     granted          origin `courtesy`, no order columns, `going` (responded_at = now()). A member with no
--                      row, or with `not_going`, is given the seat. Over the capacity on purpose (A-UI-5)
--                      and after the start (D-750), exactly like a ticket; it works with the `payments`
--                      module OFF (D-743: the mapping is the paid fact, not the flag, D-746);
--     already_in       the member already holds a `going`, `checked_in` or `walk_in` row of ANY origin: it is
--                      never rewritten (a ticket stays a ticket, EP-20);
--     event_cancelled  the event is cancelled;       event_ended   `now() >= ends_at` (D-750);
--     not_paid         the event has no payment mapping (a courtesy is a free pass to a PAID event only);
--     not_found        no claims; a NULL argument; a membership that is not a LIVE membership of the claim
--                      tenant; an event that is not this tenant's or is soft-deleted;
--     forbidden        the claim is not `admin_tenant`.
--   app.event_courtesy_remove(p_event, p_attendance) returns (outcome)
--     removed          a `going` row of origin `courtesy` that has NOT checked in is deleted;
--     locked           the row has `checked_in_at` set;
--     not_courtesy     the row is not a going courtesy: a paid presence is never removable by hand;
--     not_found        no claims, a NULL argument, or no such row in this tenant and event;
--     forbidden        the claim is not `admin_tenant`.
--   app.event_ticket_lock(p_event) returns (found, sold)
--     takes the per-event advisory lock (`hashtextextended('event_ticket:' || event, 0)`, the SAME key
--     `app.event_gateway_grant` takes, so a sale and a mapping change serialise, T-10.1-15), confirms the
--     event is this tenant's and not deleted, and counts `sold` = rows of origin `ticket` (a refunded
--     checked-in row still counts: the safe side). Not an admin, not this tenant's, deleted, unknown or NULL:
--     `found` false and `sold` 0, and NO lock is taken. The lock lives until the caller's transaction ends.
--   app.event_ticket_reset(p_event) returns void
--     sets origin back to `rsvp` on the event's `courtesy` rows (an update that touches only the origin is a
--     bookkeeping update the guard lets through), so an event returned to the instant `Vou` has no row the
--     member lane can no longer edit. Not an admin or not this tenant's event: nothing happens.
--   app.event_ticket_holders(p_event, p_memberships uuid[]) returns setof uuid
--     the ids, of the at most 50 given, whose member already holds a `going`, `checked_in` or `walk_in` row
--     of this tenant's event. More than 50, NULL, not an admin: nothing.
--
-- ── HARDENING ────────────────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER with `search_path = ''` and fully qualified names (the owner bypasses RLS, so EVERY
-- statement pins `tenant_id` to `app.tenant_id()` itself; T-10.1-01). EXECUTE is revoked from PUBLIC and anon
-- and granted to `authenticated`. Nothing here creates a policy or a privilege on `event_attendances`.
--
-- ── RELEASE ORDER ────────────────────────────────────────────────────────────────────────────────────
-- Expand-only: five new functions; no table, column, constraint or data is touched.

create or replace function app.event_courtesy_grant(p_event uuid, p_membership uuid)
returns table (outcome text)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
  v_user uuid;
  v_status text;
  v_ends_at timestamptz;
  v_att uuid;
  v_att_status text;
begin
  -- 1. No claims, no lane. Only the tenant's admin releases a courtesy, whatever route reached this function.
  if v_t is null then
    return query select 'not_found'::text;
    return;
  end if;
  if app.tenant_role() is distinct from 'admin_tenant' then
    return query select 'forbidden'::text;
    return;
  end if;
  if p_event is null or p_membership is null then
    return query select 'not_found'::text;
    return;
  end if;

  -- 2. The membership, in THIS tenant only, live: another tenant's id matches nothing.
  select m.user_id into v_user
    from public.memberships m
   where m.id = p_membership
     and m.tenant_id = v_t
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null;
  if v_user is null then
    return query select 'not_found'::text;
    return;
  end if;

  -- 3. The event, in THIS tenant only and not deleted. Checked before the lock so a foreign id takes none.
  perform 1 from public.events e
   where e.id = p_event and e.tenant_id = v_t and e.deleted_at is null;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  -- 4. The per-event lock (shared with the gateway grant and the mapping service), then the event read again
  --    and held against a concurrent cancel.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('event_ticket:' || p_event::text, 0));
  select e.status, e.ends_at into v_status, v_ends_at
    from public.events e
   where e.id = p_event and e.tenant_id = v_t and e.deleted_at is null
     for share;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  if v_status = 'cancelled' then
    return query select 'event_cancelled'::text;
    return;
  end if;
  if now() >= v_ends_at then
    return query select 'event_ended'::text;
    return;
  end if;

  -- 5. A courtesy is for a PAID event: the mapping, read under the lock.
  if not exists (select 1
                   from public.payment_products pp
                  where pp.tenant_id = v_t
                    and pp.kind = 'event'
                    and pp.event_id = p_event) then
    return query select 'not_paid'::text;
    return;
  end if;

  -- 6. ONE write. Over the capacity on purpose (A-UI-5); an existing presence is never rewritten.
  select a.id, a.status into v_att, v_att_status
    from public.event_attendances a
   where a.tenant_id = v_t
     and a.event_id = p_event
     and a.user_id = v_user
     for update;

  begin
    if v_att is null then
      insert into public.event_attendances
             (tenant_id, event_id, user_id, status, responded_at, origin)
      values (v_t, p_event, v_user, 'going', now(), 'courtesy');
    elsif v_att_status = 'not_going' then
      update public.event_attendances a
         set status = 'going',
             responded_at = now(),
             origin = 'courtesy',
             order_provider = null,
             order_ref = null,
             refunded_at = null
       where a.id = v_att and a.tenant_id = v_t;
    else
      return query select 'already_in'::text;
      return;
    end if;
  exception when unique_violation then
    return query select 'already_in'::text;
    return;
  end;

  return query select 'granted'::text;
end
$$;
--> statement-breakpoint
revoke all on function app.event_courtesy_grant(uuid, uuid) from public, anon;--> statement-breakpoint
grant execute on function app.event_courtesy_grant(uuid, uuid) to authenticated;--> statement-breakpoint

create or replace function app.event_courtesy_remove(p_event uuid, p_attendance uuid)
returns table (outcome text)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
  v_checked_in timestamptz;
  v_origin text;
  v_status text;
  v_row uuid;
begin
  -- 1. No claims, no lane; only the admin.
  if v_t is null then
    return query select 'not_found'::text;
    return;
  end if;
  if app.tenant_role() is distinct from 'admin_tenant' then
    return query select 'forbidden'::text;
    return;
  end if;
  if p_event is null or p_attendance is null then
    return query select 'not_found'::text;
    return;
  end if;

  -- 2. The row, in THIS tenant and event only, locked.
  select a.id, a.checked_in_at, a.origin, a.status into v_row, v_checked_in, v_origin, v_status
    from public.event_attendances a
   where a.id = p_attendance
     and a.event_id = p_event
     and a.tenant_id = v_t
     for update;
  if v_row is null then
    return query select 'not_found'::text;
    return;
  end if;

  -- 3. A person who was already there stays; a paid presence is never removed by hand (D-743).
  if v_checked_in is not null then
    return query select 'locked'::text;
    return;
  end if;
  if v_origin is distinct from 'courtesy' or v_status is distinct from 'going' then
    return query select 'not_courtesy'::text;
    return;
  end if;

  delete from public.event_attendances a
   where a.id = v_row and a.tenant_id = v_t;
  return query select 'removed'::text;
end
$$;
--> statement-breakpoint
revoke all on function app.event_courtesy_remove(uuid, uuid) from public, anon;--> statement-breakpoint
grant execute on function app.event_courtesy_remove(uuid, uuid) to authenticated;--> statement-breakpoint

create or replace function app.event_ticket_lock(p_event uuid)
returns table (found boolean, sold integer)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
  v_events integer;
  v_sold integer;
begin
  if v_t is null or p_event is null or app.tenant_role() is distinct from 'admin_tenant' then
    return query select false, 0;
    return;
  end if;

  -- The event must be this tenant's and live BEFORE any lock is taken (a foreign id locks nothing).
  select pg_catalog.count(*)::integer into v_events
    from public.events e
   where e.id = p_event and e.tenant_id = v_t and e.deleted_at is null;
  if v_events = 0 then
    return query select false, 0;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('event_ticket:' || p_event::text, 0));

  select pg_catalog.count(*)::integer into v_sold
    from public.event_attendances a
   where a.tenant_id = v_t
     and a.event_id = p_event
     and a.origin = 'ticket';
  return query select true, v_sold;
end
$$;
--> statement-breakpoint
revoke all on function app.event_ticket_lock(uuid) from public, anon;--> statement-breakpoint
grant execute on function app.event_ticket_lock(uuid) to authenticated;--> statement-breakpoint

create or replace function app.event_ticket_reset(p_event uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
begin
  if v_t is null or p_event is null or app.tenant_role() is distinct from 'admin_tenant' then
    return;
  end if;

  update public.event_attendances a
     set origin = 'rsvp'
   where a.tenant_id = v_t
     and a.event_id = p_event
     and a.origin = 'courtesy';
end
$$;
--> statement-breakpoint
revoke all on function app.event_ticket_reset(uuid) from public, anon;--> statement-breakpoint
grant execute on function app.event_ticket_reset(uuid) to authenticated;--> statement-breakpoint

create or replace function app.event_ticket_holders(p_event uuid, p_memberships uuid[])
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.id
    from public.memberships m
    join public.event_attendances a
      on a.tenant_id = m.tenant_id
     and a.user_id = m.user_id
   where app.tenant_role() = 'admin_tenant'
     and pg_catalog.cardinality(p_memberships) <= 50
     and m.tenant_id = app.tenant_id()
     and m.id = any (p_memberships)
     and a.event_id = p_event
     and a.status in ('going', 'checked_in', 'walk_in')
$$;
--> statement-breakpoint
revoke all on function app.event_ticket_holders(uuid, uuid[]) from public, anon;--> statement-breakpoint
grant execute on function app.event_ticket_holders(uuid, uuid[]) to authenticated;
