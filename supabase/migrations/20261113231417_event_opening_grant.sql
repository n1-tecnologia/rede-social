-- event_opening_grant (Phase 10.2, plan 05; OPEN-12, OPEN-13, OPEN-14, OPEN-15, OPEN-23, OPEN-24; D-782, D-791;
-- T-10.2-03, T-10.2-04, T-10.2-05, T-10.2-10). Hand-written (`--custom`), applied after
-- `*_event_opening_reads.sql`. EXPAND-ONLY: function definitions only; no table, column, policy or row is touched.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────────
-- Plan 01 added `event_attendances.ticket_confirmed_at`: the instant a ticket confirmed a presence. The Eventos
-- recentes list marks a payment as early when that instant is before the event's opening (D-791). Nothing wrote
-- the instant yet. `responded_at` cannot stand in for it: the grant's upgrade branch (a Vou, a courtesy, a
-- check-in or a walk-in made before the link) never touched `responded_at`, so an old Vou upgraded after the
-- opening would read as early, and the manual release stamps the admin's click time. The mark therefore needs
-- its own instant, written by the grant on EVERY write path.
--
-- ── WHAT ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. `app.event_gateway_grant` is the LATEST definition (it replaces the one in
--    `20261113144645_event_gateway_grant_replay_first.sql`, which is never edited): the same six-argument
--    signature, return table, steps, outcome strings and grants, byte for byte, plus ONE addition: the three
--    write statements of step 10 (the insert when no row exists, the `not_going` to `going` update, and the
--    upgrade of a `going`, `checked_in` or `walk_in` row) also set `ticket_confirmed_at` to `now()`. A replay
--    (`already_in`) returns before any write, so it never rewrites the instant.
--    THE GRANT DELIBERATELY HAS NO CHECK OF THE OPENING INSTANT (D-782): a payment that arrives before the
--    opening confirms the presence anyway. The money is already charged and the paid path never refuses a
--    willing buyer. Refusing later would mean refunds and a new refusal path in the webhook branch.
-- 2. `app.event_attendance_guard()` is the LATEST definition (it replaces the one in
--    `20261113141716_event_ticket_bookkeeping_lock.sql`, never edited): the member lane (`authenticated`) can no
--    longer write the new column (step 1a, 42501 `bookkeeping_locked`), and the bookkeeping exit (step 1b)
--    ignores it, so the grant's upgrade stays a pure bookkeeping update that no member rule judges. The trigger
--    keeps pointing at the same function.
-- 3. `app.event_ticket_before_opening(tenant, event, provider, order_ref)`: the Pagamentos list asks, per
--    delivery, whether the payment was confirmed before the event's opening. `service_role` only.
--
-- ── THE DERIVED RULE `before_opening` (documented once; plan 07 mirrors it in the service) ────────────
--   origin = 'ticket' and ticket_confirmed_at is not null and the event's opening is not null
--   and ticket_confirmed_at < the opening
-- Strict: a confirmation at the exact opening instant is open, one microsecond earlier is early (it matches
-- `app.event_checkout_url`'s `<= now()`). Stable: the opening cannot change while any row of origin `ticket`
-- exists (plan 04), a refund that deletes the only ticket row removes the mark with the row, and a row written
-- before this release has a null instant and is never marked.
--
-- ── HARDENING ────────────────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER with `search_path = ''` and fully qualified names, tenant pinned in every statement, EXECUTE
-- revoked from public, anon and authenticated and granted to `service_role` only (the shape of
-- `app.event_title_for`). No notification, push or bell row is emitted by any of it.
--
-- ── SAFE ─────────────────────────────────────────────────────────────────────────────────────────────
-- `create or replace`, so re-running it is safe in the fan-out ledger. The `revoke` and `grant` statements are
-- restated. Reversible by a later migration that restores the previous bodies.

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

  -- 7. WR-03 replay first. The same order again (a replay, EP-20) or the same reference twice in this tenant
  --    (EP-36): one reference is one presence, whoever holds it. It is answered BEFORE the state of the event,
  --    because a replay confirms nothing new, so it reports what is true in every state (active, ended,
  --    cancelled, soft-deleted). Nothing is written.
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

  -- A different order by a member who already holds a ticket (A10: one presence per member and event): also
  -- before the state of the event, for the same reason.
  if v_att is not null and v_att_origin = 'ticket' then
    return query select 'already_in'::text, v_user, v_title, false;
    return;
  end if;

  -- 9. A FIRST-TIME grant is still refused once the event is cancelled, deleted or over (D-750, D-760).
  if v_deleted_at is not null or v_status = 'cancelled' then
    return query select 'event_cancelled'::text, null::uuid, null::text, false;
    return;
  end if;
  if now() >= v_ends_at then
    return query select 'event_ended'::text, null::uuid, null::text, false;
    return;
  end if;

  -- 10. ONE write. Each of the three paths also records WHEN the presence was confirmed (D-791).
  begin
    if v_att is null then
      insert into public.event_attendances
             (tenant_id, event_id, user_id, status, responded_at, origin, order_provider, order_ref, ticket_confirmed_at)
      values (p_tenant, p_event, v_user, 'going', now(), 'ticket', p_provider, v_ref, now());
    elsif v_att_status = 'not_going' then
      update public.event_attendances a
         set status = 'going',
             responded_at = now(),
             origin = 'ticket',
             order_provider = p_provider,
             order_ref = v_ref,
             refunded_at = null,
             ticket_confirmed_at = now()
       where a.id = v_att and a.tenant_id = p_tenant;
    else
      -- `going` (rsvp / courtesy), `checked_in` or `walk_in`: the status stays, origin and order change.
      update public.event_attendances a
         set origin = 'ticket',
             order_provider = p_provider,
             order_ref = v_ref,
             refunded_at = null,
             ticket_confirmed_at = now()
       where a.id = v_att and a.tenant_id = p_tenant;
    end if;
  exception when unique_violation then
    -- The reference was taken on another event between step 7 and here: it is already a presence.
    return query select 'already_in'::text, v_user, v_title, false;
    return;
  end;

  -- 11. Over the limit? (information only: a payment never fails for want of a seat, D-751.)
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
  to service_role;
--> statement-breakpoint

-- ── 2. THE GUARD KNOWS THE COLUMN ──────────────────────────────────────────────────────────────────
-- LATEST definition of `app.event_attendance_guard()`: a byte copy of the body in
-- `20261113141716_event_ticket_bookkeeping_lock.sql` with two changes, both for `ticket_confirmed_at`:
--   * step 1a: the member lane (`authenticated`) changing the column is refused with 42501, the named constraint
--     `event_attendances_bookkeeping_locked` and the message `bookkeeping_locked`, BEFORE the bookkeeping exit and
--     before the CHECK of plan 01 (T-10.2-03: a member can neither forge nor erase the instant that marks a
--     payment early);
--   * step 1b: the column is removed from both sides of the `to_jsonb(...)` comparison, so the grant's upgrade
--     update (order columns plus the instant, run as the definer owner) stays a pure bookkeeping update that no
--     member rule judges.
-- The member lane never writes the instant: the grant stamps it as a definer. Every other step, name and message
-- is unchanged and the trigger `event_attendances_guard` keeps pointing at the same function (never recreated).
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

  -- 1a. The bookkeeping lock (10.1 gap, CR-01; 10.2, T-10.2-03): the member lane never writes the order columns
  --     or the confirmation instant. Placed BEFORE the bookkeeping exit, which would otherwise return a member's
  --     rewrite of them.
  if tg_op = 'UPDATE' and current_user = 'authenticated'
     and (new.origin is distinct from old.origin
          or new.order_provider is distinct from old.order_provider
          or new.order_ref is distinct from old.order_ref
          or new.refunded_at is distinct from old.refunded_at
          or new.ticket_confirmed_at is distinct from old.ticket_confirmed_at) then
    raise exception using errcode = '42501', constraint = 'event_attendances_bookkeeping_locked',
                          message = 'bookkeeping_locked';
  end if;

  -- 1b. Bookkeeping exit (10.1): only origin, order_provider, order_ref, refunded_at, ticket_confirmed_at or
  --     updated_at changed. Not an answer and not a check-in, so no later step judges it.
  if tg_op = 'UPDATE'
     and to_jsonb(new) - 'origin' - 'order_provider' - 'order_ref' - 'refunded_at' - 'ticket_confirmed_at' - 'updated_at'
         = to_jsonb(old) - 'origin' - 'order_provider' - 'order_ref' - 'refunded_at' - 'ticket_confirmed_at' - 'updated_at' then
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
--> statement-breakpoint

-- ── 3. THE DELIVERY DEFINER ─────────────────────────────────────────────────────────────────────────
-- `app.event_ticket_before_opening(tenant, event, provider, order_ref)`: true iff the attendance row of THIS tenant
-- found by provider and trimmed order reference belongs to the given event and satisfies the derived rule
-- `before_opening` above. A NULL or malformed argument, another tenant's reference, an unknown reference, a
-- reference of another event and a row that is not a ticket are false. The tenant is an ARGUMENT pinned in every
-- statement (the owner bypasses RLS); `service_role` only, like `app.event_title_for` (the Pagamentos list runs in
-- the admin lane and asks per delivery).
create or replace function app.event_ticket_before_opening(
  p_tenant uuid,
  p_event uuid,
  p_provider text,
  p_order_ref text
)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ref text := pg_catalog.btrim(p_order_ref, E' \t\r\n');
  v_result boolean;
begin
  if p_tenant is null or p_event is null or p_provider is null or p_order_ref is null
     or p_provider !~ '^[a-z][a-z0-9_]{1,30}$'
     or v_ref = '' or pg_catalog.char_length(v_ref) > 200 or v_ref ~ '[[:cntrl:]]' then
    return false;
  end if;

  select (a.origin = 'ticket'
          and a.ticket_confirmed_at is not null
          and e.registration_opens_at is not null
          and a.ticket_confirmed_at < e.registration_opens_at)
    into v_result
    from public.event_attendances a
    join public.events e on e.id = a.event_id and e.tenant_id = a.tenant_id
   where a.tenant_id = p_tenant
     and a.event_id = p_event
     and a.order_provider = p_provider
     and a.order_ref = v_ref;

  return coalesce(v_result, false);
end
$$;
--> statement-breakpoint
revoke all on function app.event_ticket_before_opening(uuid, uuid, text, text)
  from public, anon, authenticated;--> statement-breakpoint
grant execute on function app.event_ticket_before_opening(uuid, uuid, text, text)
  to service_role;
