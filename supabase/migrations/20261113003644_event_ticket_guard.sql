-- event_ticket_guard (Phase 10.1, plan 02, D-741 / D-748 / D-754) — the DATABASE half of the closed
-- door. In an event that has a payment mapping (kind `event`, plan 01), a member's OWN move into
-- `going` is refused: the only road to a presence is an approved payment or the admin's courtesy,
-- both written by the server under another `origin`. Its companion `20261113003640_event_ticket_member_lane.sql`
-- is the GENERATED half (the two member-lane policies now pin `origin = 'rsvp'`, `order_ref is null`
-- and `refunded_at is null` on the new row); this file is the rule drizzle-kit cannot model.
--
-- WHAT CHANGES. `app.event_attendance_guard()` is re-created (`create or replace`, same signature, so
-- the trigger from `20260927154335_event_attendance_guard.sql` keeps pointing at it; re-run safe) with
-- the body of `20261003233626_event_capacity_guard.sql` plus three additions. Steps 1 to 7 keep their
-- names, their order and their messages, so every refusal that existed keeps its constraint name:
--   * the bookkeeping exit (right after step 1): an UPDATE that changes ONLY `origin`, `order_provider`,
--     `order_ref`, `refunded_at` or `updated_at` returns the row at once. A refund flag or an origin
--     upgrade written by a definer is bookkeeping, not an answer; judging it by the cancelled, start
--     or checked-in steps would raise inside the apply job's transaction and loop its retry
--     (Pitfalls 1 and 3). The comparison is on the whole row minus those five keys, so a column added to the table
--     later is NOT exempt: changing it makes the update an ordinary one and the old rules judge it.
--   * step 2b: `v_paid`, the paid fact, read from `app.event_ticket_mapped` (below).
--   * step 3b: in a paid event a move INTO `going` (an INSERT of `going`, or an UPDATE from another
--     status) whose `origin` is `rsvp` raises SQLSTATE 23514, constraint
--     `event_attendances_payment_required`, message `payment_required`.
-- The guard judges the proposed tuple BEFORE the upsert's arbiter, so a ticket holder who answers Vou
-- again trips 3b too; the service tells that repeat apart with one read of the caller's own row
-- (`rsvpEvent`, like `fullEventAnswer`). A presence made before the link keeps working: it is
-- `going` already and the guard judges only moves INTO going (D-748, origin is derived, never backfilled).
--
-- WHERE THE PAID FACT COMES FROM. `app.event_ticket_mapped(p_tenant, p_event)` reads `payment_products`
-- whatever the `payments` module flag says (D-746: a module turned off must never reopen the free Vou),
-- as a definer because the member lane cannot read that admin-only table. When claims are present it
-- answers false unless `p_tenant = app.tenant_id()`, so it cannot be used to probe another tenant's
-- mappings. The guard trusts no session setting and no client value: its only inputs are the table
-- columns, and the member policy pins `origin` to `rsvp`.
--
-- EXPAND-ONLY. Two function definitions; no table, column or data is touched.

create or replace function app.event_ticket_mapped(p_tenant uuid, p_event uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
           select 1
             from public.payment_products p
            where p.tenant_id = p_tenant
              and p.kind = 'event'
              and p.event_id = p_event
         )
         and (nullif(current_setting('request.jwt.claims', true), '') is null
              or p_tenant = app.tenant_id())
$$;
--> statement-breakpoint
revoke all on function app.event_ticket_mapped(uuid, uuid) from public, anon;
--> statement-breakpoint
grant execute on function app.event_ticket_mapped(uuid, uuid) to authenticated, service_role;
--> statement-breakpoint
create or replace function app.event_attendance_guard() returns trigger
  language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_capacity integer;
  v_confirmed integer;
  v_paid boolean;
begin
  -- 1. A row never moves: its tenant, event and member are its identity.
  if tg_op = 'UPDATE' and (new.tenant_id is distinct from old.tenant_id
                           or new.event_id is distinct from old.event_id
                           or new.user_id is distinct from old.user_id) then
    raise exception using errcode = '23514', constraint = 'event_attendances_immutable',
                          message = 'attendance_immutable';
  end if;

  -- 1b. Bookkeeping exit (10.1): only origin, order_provider, order_ref, refunded_at or updated_at
  --     changed. Not an answer and not a check-in, so no later step judges it.
  if tg_op = 'UPDATE'
     and to_jsonb(new) - 'origin' - 'order_provider' - 'order_ref' - 'refunded_at' - 'updated_at'
         = to_jsonb(old) - 'origin' - 'order_provider' - 'order_ref' - 'refunded_at' - 'updated_at' then
    return new;
  end if;

  -- 2. The event, read in THIS tenant and locked against a concurrent cancel or edit.
  select e.status, e.starts_at, e.ends_at, e.capacity
    into v_status, v_starts_at, v_ends_at, v_capacity
    from public.events e
   where e.id = new.event_id
     and e.tenant_id = new.tenant_id
     and e.deleted_at is null
     for share;
  if not found then
    raise exception using errcode = '23503', constraint = 'event_attendances_event_visible',
                          message = 'event_not_found';
  end if;

  -- 2b. Is this a paid event? (10.1, D-741) Whatever the payments module flag says (D-746).
  v_paid := app.event_ticket_mapped(new.tenant_id, new.event_id);

  -- 3. A checked-in row keeps its status for good (D-204: "once checked in, the answer is locked").
  if tg_op = 'UPDATE' and old.checked_in_at is not null
     and new.status is distinct from old.status then
    raise exception using errcode = '23514', constraint = 'event_attendances_locked',
                          message = 'attendance_locked';
  end if;

  -- 3b. A member's own move INTO going in a paid event is a payment, not an answer (D-741).
  if v_paid and new.status = 'going' and new.origin = 'rsvp'
     and (tg_op = 'INSERT' or old.status is distinct from 'going') then
    raise exception using errcode = '23514', constraint = 'event_attendances_payment_required',
                          message = 'payment_required';
  end if;

  -- 4. A cancelled event takes no answer and no check-in (D-201).
  if v_status = 'cancelled' then
    raise exception using errcode = '23514', constraint = 'event_attendances_event_active',
                          message = 'cancelled';
  end if;

  -- 5. RSVP is open strictly before the start (D-204).
  if new.status in ('going', 'not_going') and now() >= v_starts_at then
    raise exception using errcode = '23514', constraint = 'event_attendances_rsvp_open',
                          message = 'rsvp_closed';
  end if;

  -- 6. A check-in lands only inside the window (D-209). An UPDATE of a row that already checked in
  --    (a later edit of an unrelated column) is not a new check-in and is not re-judged.
  if new.status in ('checked_in', 'walk_in')
     and (tg_op = 'INSERT' or old.checked_in_at is null) then
    if now() < v_starts_at - interval '1 hour' then
      raise exception using errcode = '23514', constraint = 'event_attendances_checkin_window',
                            message = 'checkin_not_open';
    end if;
    if now() >= v_ends_at then
      raise exception using errcode = '23514', constraint = 'event_attendances_checkin_window',
                            message = 'checkin_closed';
    end if;
  end if;

  -- 7. A full event takes no new Vou (2026-10-03). See `20261003233626_event_capacity_guard.sql`:
  --    only a move INTO `going` on an event with a limit is judged, against the OTHER members'
  --    confirmed count, under a transaction-scoped advisory lock on the event.
  if v_capacity is not null and new.status = 'going'
     and (tg_op = 'INSERT' or old.status is distinct from 'going') then
    perform pg_advisory_xact_lock(hashtextextended('event_capacity:' || new.event_id::text, 0));
    select count(*)
      into v_confirmed
      from public.event_attendances a
     where a.tenant_id = new.tenant_id
       and a.event_id = new.event_id
       and a.user_id <> new.user_id
       and a.status in ('going', 'checked_in');
    if v_confirmed >= v_capacity then
      raise exception using errcode = '23514', constraint = 'event_attendances_capacity',
                            message = 'event_full';
    end if;
  end if;

  return new;
end
$$;
