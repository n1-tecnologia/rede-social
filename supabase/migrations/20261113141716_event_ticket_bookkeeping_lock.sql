-- event_ticket_bookkeeping_lock (Phase 10.1, gap plan 16, CR-01, D-741 / D-752 / D-754 / D-747) — the member
-- lane can no longer rewrite the order columns of an attendance row. This file is the LATEST definition of
-- `app.event_attendance_guard()`: it replaces the body of `20261113003918_event_ticket_guard_exceptions.sql`,
-- which was already applied and is never edited.
--
-- WHY: the guard's bookkeeping exit (step 1b) returns the row as soon as only `origin`, `order_provider`,
-- `order_ref`, `refunded_at` or `updated_at` changed, before any member rule runs, and the update policy's
-- USING does not pin the origin. So a member could strip the order reference and the origin of their own paid
-- or courtesy row with a plain UPDATE. The consequences were two: a refund looks the row up by tenant,
-- provider and order reference and no longer found it (the buyer kept the seat), and the count of sold
-- tickets (origin `ticket`) that locks the product could be lowered by a member.
--
-- WHAT: one new block in the guard, numbered 1a, placed right after step 1 (a row never moves) and BEFORE
-- the bookkeeping exit. On an UPDATE run by the role `authenticated`, a change to any of the four columns
-- is refused with errcode 42501, the named constraint for the bookkeeping lock and the message
-- `bookkeeping_locked`. Every other step, name and message of the body is copied byte for byte.
--
-- WHY NOT THE POLICY: pinning the origin in the update USING would turn the `rsvpEvent` upsert path's named
-- `ticket_locked` and `payment_required` refusals into a bare 42501, so the refusal lives in the guard.
--
-- WHY `current_user`: the member lane runs as `authenticated`. The definers (the apply lane's
-- `app.event_gateway_grant` and `_revoke`, the courtesy definers and `app.event_ticket_reset`) run as their
-- owner and the apply job and the refund stamp run as `service_role`, so none of them is judged. The guard
-- trusts no session setting and no client value: the refusal depends on the role and on the four columns.
--
-- SAFE: `create or replace`, same signature, so the trigger keeps pointing at it; re-run safe in the fan-out
-- ledger. EXPAND-ONLY: one function definition, no table, column, policy, grant or row touched. Reversible by
-- a later migration that restores the previous body.
--
-- NO API VOCABULARY CHANGE: no API path writes these four columns, so the new constraint name is not added
-- to `GUARD_ISSUES` or `EVENT_ISSUES`.

create or replace function app.event_attendance_guard() returns trigger
  language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_capacity integer;
  v_confirmed integer;
  v_paid boolean;
  v_paid_path boolean;
begin
  -- 1. A row never moves: its tenant, event and member are its identity.
  if tg_op = 'UPDATE' and (new.tenant_id is distinct from old.tenant_id
                           or new.event_id is distinct from old.event_id
                           or new.user_id is distinct from old.user_id) then
    raise exception using errcode = '23514', constraint = 'event_attendances_immutable',
                          message = 'attendance_immutable';
  end if;

  -- 1a. The bookkeeping lock (10.1 gap, CR-01): the member lane never writes the order columns. Placed
  --     BEFORE the bookkeeping exit, which would otherwise return a member's rewrite of them.
  if tg_op = 'UPDATE' and current_user = 'authenticated'
     and (new.origin is distinct from old.origin
          or new.order_provider is distinct from old.order_provider
          or new.order_ref is distinct from old.order_ref
          or new.refunded_at is distinct from old.refunded_at) then
    raise exception using errcode = '42501', constraint = 'event_attendances_bookkeeping_locked',
                          message = 'bookkeeping_locked';
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

  -- 2b. Is this a paid event? (10.1, D-741) Whatever the payments module flag says (D-746). And is
  --     this row on the paid path (a payment or the admin's courtesy), the only origins that skip
  --     the start and capacity rules (D-750, D-751)?
  v_paid := app.event_ticket_mapped(new.tenant_id, new.event_id);
  v_paid_path := new.origin in ('ticket', 'courtesy');

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

  -- 3c. A paid or courtesy presence is not given back by a Não vou (D-754).
  if tg_op = 'UPDATE' and old.origin in ('ticket', 'courtesy')
     and old.status = 'going' and new.status = 'not_going' then
    raise exception using errcode = '23514', constraint = 'event_attendances_ticket_locked',
                          message = 'ticket_locked';
  end if;

  -- 4. A cancelled event takes no answer and no check-in (D-201).
  if v_status = 'cancelled' then
    raise exception using errcode = '23514', constraint = 'event_attendances_event_active',
                          message = 'cancelled';
  end if;

  -- 5. RSVP is open strictly before the start (D-204). The paid path is judged by the END instead
  --    (D-750): a payment approved after the start still confirms, but never after the event is over.
  if v_paid_path then
    if new.status = 'going' and (tg_op = 'INSERT' or old.status is distinct from 'going')
       and now() >= v_ends_at then
      raise exception using errcode = '23514', constraint = 'event_attendances_event_ended',
                            message = 'event_ended';
    end if;
  elsif new.status in ('going', 'not_going') and now() >= v_starts_at then
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

  -- 6b. Backstop: a walk-in has no ticket, so in a paid event it is refused (the check-in definers
  --     answer `ticket_required` first; this is the last line).
  if v_paid and new.status = 'walk_in'
     and (tg_op = 'INSERT' or old.checked_in_at is null) then
    raise exception using errcode = '23514', constraint = 'event_attendances_payment_required',
                          message = 'payment_required';
  end if;

  -- 7. A full event takes no new Vou (2026-10-03). See `20261003233626_event_capacity_guard.sql`:
  --    only a move INTO `going` on an event with a limit is judged, against the OTHER members'
  --    confirmed count, under a transaction-scoped advisory lock on the event. A ticket or a
  --    courtesy skips it (D-751): the seat was paid for or given.
  if v_capacity is not null and new.status = 'going' and not v_paid_path
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
