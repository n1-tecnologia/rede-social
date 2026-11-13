-- event_gateway_grant_revoke (Phase 10.1, plan 04; TICK-03, TICK-04, TICK-07, TICK-09, TICK-10, TICK-11,
-- TICK-21; D-741, D-750, D-751, D-752, D-759, D-760; T-10.1-01, T-10.1-07, T-10.1-09, T-10.1-10, T-10.1-15).
-- Hand-written (`--custom`), applied after the plan 02 guard (`*_event_ticket_guard_exceptions.sql`) and the
-- plan 03 doors (`*_event_ticket_doors.sql`).
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────────
-- The payments module (kernel side) cannot import `module-events` (MOD-02), so the effect of an approved
-- purchase on an event presence is SQL BY NAME, exactly like `app.store_gateway_purchase` /
-- `app.store_gateway_revoke` are for the store. These two functions are the ONLY way a presence of origin
-- `ticket` is created or removed (D-741 is "the only two ways to a presence": this one and the admin's
-- courtesy, `*_event_courtesy_definers.sql`). The webhook has no member JWT, so both take the tenant and
-- the membership as ARGUMENTS (D-509) and EVERY statement pins `tenant_id = p_tenant`.
--
-- ── OUTCOMES (RETURNED, never raised, so the apply job's transaction commits whatever they are) ──────
--   app.event_gateway_grant(p_tenant, p_membership, p_event, p_provider, p_order_ref, p_admin_release)
--     returns (outcome, user_id, event_title, over_limit)
--     granted          a presence of origin `ticket` now exists for that member and event, with the order
--                      columns. A member with no row, or with `not_going`, becomes `going` (responded_at =
--                      now()). A `going` row of origin `rsvp` or `courtesy` is UPGRADED to origin `ticket`
--                      with the order columns, its status untouched (they paid: assumption A10b, so a later
--                      refund removes it). A present row (`checked_in`, `walk_in`) of ANY origin takes origin
--                      `ticket` and the order columns, its status untouched. `user_id` and `event_title`
--                      come back for the confirmation notice; `over_limit` is true when the confirmed count
--                      (`going` + `checked_in`) after the write is above the event's `capacity` (D-751: a
--                      payment never fails for want of a seat);
--     already_in       the reference already names a presence of THIS tenant (the same order again, EP-20,
--                      or the same reference twice, EP-36), or the member already holds a ticket from
--                      another order (A10: one presence per member and event). Nothing is written;
--     event_cancelled  the event is cancelled OR soft-deleted (D-760);
--     event_ended      `now() >= ends_at` (D-750: a payment after the start still confirms, never after
--                      the end);
--     not_mapped       the event has no payment mapping in THIS tenant (read AGAIN under the lock, so a
--                      mapping removed mid-sale never leaves an unmapped paid presence, T-10.1-15);
--     unconfirmed      the member's e-mail is unconfirmed and `p_admin_release` is false (D-759, T-10.1-10:
--                      the webhook never confirms an account somebody registered with another person's
--                      address; the delivery stays "sem conta" and the admin releases it by hand, which
--                      passes `p_admin_release = true`);
--     not_found        a NULL argument; a provider outside `^[a-z][a-z0-9_]{1,30}$`; a reference that is empty
--                      after trimming, longer than 200 characters or carrying a control character; a
--                      membership that is not a LIVE membership of THIS tenant (`active`, not blocked, not
--                      deleted). Nothing is written.
--   app.event_gateway_revoke(p_tenant, p_provider, p_order_ref) returns (outcome, user_id, event_id)
--     removed          the presence carrying that order reference is DELETED, so the seat is free again
--                      (D-760, "a refund removes the row");
--     kept             the row has `checked_in_at` set: it stays (the person was there) and `refunded_at`
--                      is stamped. The count of sold tickets still includes it, the safe side;
--     not_found        the same argument validation, or no presence carries that reference in THIS tenant
--                      (an unknown order, another tenant's order, a courtesy or a presence made before the
--                      link, which carry no reference and so can never be reached, T-10.1-09).
--   The revoke finds the row by `(tenant_id, order_provider, order_ref)` through `event_attendances_order_uq`,
--   WITHOUT a member and WITHOUT any event status or `deleted_at` filter: a refund must work for a blocked or
--   removed buyer and for a cancelled or deleted event.
--
-- ── WHY NOTHING RAISES ───────────────────────────────────────────────────────────────────────────────
-- The attendance guard (plan 02) is a BACKSTOP: it would raise `event_ended` / `cancelled` inside the apply
-- job's transaction, which would roll back and retry forever. So each definer PRE-CHECKS the conditions the
-- guard would refuse (cancelled, ended, deleted, mapped) and RETURNS them as outcomes. The write paths below
-- pass the guard by construction: origin `ticket` skips the start and capacity rules (D-750, D-751), and an
-- update that changes only origin, the order columns or `refunded_at` is a bookkeeping update the guard lets
-- through before the cancelled step (a refund flag on a cancelled event, or an upgrade of a checked-in row).
-- The event row is held `for share` for the whole call, so a concurrent cancel waits for the write.
--
-- ── CONCURRENCY ──────────────────────────────────────────────────────────────────────────────────────
-- One transaction-scoped advisory lock per event, key `hashtextextended('event_ticket:' || event, 0)`: the
-- SAME key `app.event_ticket_lock` takes for the mapping service (plan 06), so a sale and a mapping removal
-- serialise. The member's row is read `for update`. A concurrent grant of the same reference on ANOTHER event
-- (the unique order index is per tenant, not per event) is caught as `unique_violation` and answered
-- `already_in`: still no raise. The revoke locks the row `for update`.
--
-- ── HARDENING ────────────────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER with `search_path = ''` and fully qualified names. Both functions are EXECUTE-able by
-- `service_role` ONLY (revoked from public, anon and authenticated): a member or `support_tenant` lane must
-- never grant itself a ticket. A reference is stored trimmed (spaces, tab, CR, LF) and compared EXACTLY,
-- case-sensitively. No policy or privilege on `event_attendances` is added or changed by this file.
--
-- ── RELEASE ORDER ────────────────────────────────────────────────────────────────────────────────────
-- Expand-only: two new functions; no table, column, constraint or data is touched.

create or replace function app.event_gateway_grant(
  p_tenant uuid,
  p_membership uuid,
  p_event uuid,
  p_provider text,
  p_order_ref text,
  p_admin_release boolean default false
)
returns table (outcome text, user_id uuid, event_title text, over_limit boolean)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_ref text := pg_catalog.btrim(p_order_ref, E' \t\r\n');
  v_user uuid;
  v_title text;
  v_status text;
  v_ends_at timestamptz;
  v_capacity integer;
  v_deleted_at timestamptz;
  v_att uuid;
  v_att_status text;
  v_att_origin text;
  v_confirmed integer;
begin
  -- 1. Arguments: a NULL, a malformed provider or a malformed reference is `not_found` and writes nothing.
  if p_tenant is null or p_membership is null or p_event is null or p_provider is null
     or p_order_ref is null
     or p_provider !~ '^[a-z][a-z0-9_]{1,30}$'
     or v_ref = '' or pg_catalog.char_length(v_ref) > 200 or v_ref ~ '[[:cntrl:]]' then
    return query select 'not_found'::text, null::uuid, null::text, false;
    return;
  end if;

  -- 2. The membership: a LIVE membership of THIS tenant (another tenant's id matches nothing).
  select m.user_id into v_user
    from public.memberships m
   where m.id = p_membership
     and m.tenant_id = p_tenant
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null;
  if v_user is null then
    return query select 'not_found'::text, null::uuid, null::text, false;
    return;
  end if;

  -- 3. D-759: the webhook never confirms an unconfirmed account. Only the admin's deliberate manual
  --    release passes `p_admin_release = true`.
  if not coalesce(p_admin_release, false)
     and app.membership_email_unconfirmed(p_tenant, p_membership) then
    return query select 'unconfirmed'::text, null::uuid, null::text, false;
    return;
  end if;

  -- 4. The per-event lock, shared with the mapping service (`app.event_ticket_lock`).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('event_ticket:' || p_event::text, 0));

  -- 5. The mapping, re-read UNDER the lock (T-10.1-15): a mapping removed mid-sale is `not_mapped`.
  if not exists (select 1
                   from public.payment_products pp
                  where pp.tenant_id = p_tenant
                    and pp.kind = 'event'
                    and pp.event_id = p_event) then
    return query select 'not_mapped'::text, null::uuid, null::text, false;
    return;
  end if;

  -- 6. The event, in THIS tenant only, held against a concurrent cancel or edit.
  select e.title, e.status, e.ends_at, e.capacity, e.deleted_at
    into v_title, v_status, v_ends_at, v_capacity, v_deleted_at
    from public.events e
   where e.id = p_event and e.tenant_id = p_tenant
     for share;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, false;
    return;
  end if;
  if v_deleted_at is not null or v_status = 'cancelled' then
    return query select 'event_cancelled'::text, null::uuid, null::text, false;
    return;
  end if;
  if now() >= v_ends_at then
    return query select 'event_ended'::text, null::uuid, null::text, false;
    return;
  end if;

  -- 7. The same order again (a replay, EP-20) or the same reference twice in this tenant (EP-36): one
  --    reference is one presence, whoever holds it. Nothing is written.
  perform 1
     from public.event_attendances a
    where a.tenant_id = p_tenant
      and a.order_provider = p_provider
      and a.order_ref = v_ref;
  if found then
    return query select 'already_in'::text, v_user, v_title, false;
    return;
  end if;

  -- 8. The member's own row for this event, locked.
  select a.id, a.status, a.origin into v_att, v_att_status, v_att_origin
    from public.event_attendances a
   where a.tenant_id = p_tenant
     and a.event_id = p_event
     and a.user_id = v_user
     for update;

  -- A different order by a member who already holds a ticket (A10: one presence per member and event).
  if v_att is not null and v_att_origin = 'ticket' then
    return query select 'already_in'::text, v_user, v_title, false;
    return;
  end if;

  -- 9. ONE write.
  begin
    if v_att is null then
      insert into public.event_attendances
             (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref)
      values (p_tenant, p_event, v_user, 'going', now(), 'ticket', p_provider, v_ref);
    elsif v_att_status = 'not_going' then
      update public.event_attendances a
         set status = 'going',
             responded_at = now(),
             origin = 'ticket',
             order_provider = p_provider,
             order_ref = v_ref,
             refunded_at = null
       where a.id = v_att and a.tenant_id = p_tenant;
    else
      -- `going` (rsvp / courtesy), `checked_in` or `walk_in`: the status stays, origin and order change.
      update public.event_attendances a
         set origin = 'ticket',
             order_provider = p_provider,
             order_ref = v_ref,
             refunded_at = null
       where a.id = v_att and a.tenant_id = p_tenant;
    end if;
  exception when unique_violation then
    -- The reference was taken on another event between step 7 and here: it is already a presence.
    return query select 'already_in'::text, v_user, v_title, false;
    return;
  end;

  -- 10. Over the limit? (information only: a payment never fails for want of a seat, D-751.)
  if v_capacity is not null then
    select pg_catalog.count(*)::integer into v_confirmed
      from public.event_attendances a
     where a.tenant_id = p_tenant
       and a.event_id = p_event
       and a.status in ('going', 'checked_in');
  end if;

  return query select 'granted'::text, v_user, v_title,
                      (v_capacity is not null and v_confirmed > v_capacity);
end
$$;
--> statement-breakpoint
revoke all on function app.event_gateway_grant(uuid, uuid, uuid, text, text, boolean)
  from public, anon, authenticated;--> statement-breakpoint
grant execute on function app.event_gateway_grant(uuid, uuid, uuid, text, text, boolean)
  to service_role;--> statement-breakpoint

create or replace function app.event_gateway_revoke(
  p_tenant uuid,
  p_provider text,
  p_order_ref text
)
returns table (outcome text, user_id uuid, event_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_ref text := pg_catalog.btrim(p_order_ref, E' \t\r\n');
  v_att uuid;
  v_user uuid;
  v_event uuid;
  v_checked_in timestamptz;
begin
  -- 1. Arguments: the same validation as the grant.
  if p_tenant is null or p_provider is null or p_order_ref is null
     or p_provider !~ '^[a-z][a-z0-9_]{1,30}$'
     or v_ref = '' or pg_catalog.char_length(v_ref) > 200 or v_ref ~ '[[:cntrl:]]' then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;

  -- 2. The presence that carries this order reference in THIS tenant, locked. No member, no event status,
  --    no `deleted_at`: a refund works for a blocked buyer and for a cancelled or deleted event. A row with
  --    no order reference (a courtesy, a Vou made before the link) can never match (T-10.1-09).
  select a.id, a.user_id, a.event_id, a.checked_in_at
    into v_att, v_user, v_event, v_checked_in
    from public.event_attendances a
   where a.tenant_id = p_tenant
     and a.order_provider = p_provider
     and a.order_ref = v_ref
     for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;

  -- 3. A person who was already there keeps the row and is flagged; anybody else loses it.
  if v_checked_in is not null then
    update public.event_attendances a
       set refunded_at = coalesce(a.refunded_at, now())
     where a.id = v_att and a.tenant_id = p_tenant;
    return query select 'kept'::text, v_user, v_event;
    return;
  end if;

  delete from public.event_attendances a
   where a.id = v_att and a.tenant_id = p_tenant;
  return query select 'removed'::text, v_user, v_event;
end
$$;
--> statement-breakpoint
revoke all on function app.event_gateway_revoke(uuid, text, text) from public, anon, authenticated;--> statement-breakpoint
grant execute on function app.event_gateway_revoke(uuid, text, text) to service_role;
