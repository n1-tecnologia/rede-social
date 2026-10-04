-- event_capacity_guard (2026-10-03, "Últimas N vagas") — `app.event_attendance_guard()` gains its
-- step 7: a full event takes no new Vou. Its companion `20261003233449_event_category_capacity.sql`
-- is the GENERATED half (the nullable `events.capacity` column and its CHECK); this file is the rule
-- drizzle-kit cannot model. Steps 1-6 are `20260927154335_event_attendance_guard.sql` VERBATIM, so
-- every refusal they raise keeps its name, its order and its message.
--
-- WHAT COUNTS. D-219's confirmed count, `going + checked_in`, of the OTHER members of the event: the
-- writer's own row never counts against itself, so a member already going who answers Vou again (or
-- whose ON CONFLICT update re-fires the guard) is never refused. A walk-in is not a confirmation and
-- does not count, as in D-219. Only a move INTO `going` is judged (an INSERT of `going`, or an UPDATE
-- from another status): a Não vou, a check-in and a walk-in never are, so the door is never closed by
-- a limit that was meant for the answers.
--
-- WHY AN ADVISORY LOCK AND NOT `FOR UPDATE` (Pitfall 3, restated). Two concurrent Vou on the last seat
-- must not both pass, so the count has to be serialised per event. Upgrading the guard's `FOR SHARE`
-- on the event row to `FOR UPDATE` would conflict with the check-in functions, which take the same
-- `FOR SHARE` before they write here, and a SHARE-then-UPDATE upgrade inside one transaction is
-- exactly the deadlock the original guard avoids. A transaction-scoped advisory lock on the event id
-- serialises ONLY the Vou answers of a limited event, and is released at commit. The guard is VOLATILE
-- (the default), so under READ COMMITTED the count after the wait takes a fresh snapshot and sees the
-- answer that just committed.
--
-- THE REFUSAL. SQLSTATE 23514 with `constraint = 'event_attendances_capacity'` and message
-- `event_full`, the shape every other refusal of this guard has, so the service maps it as it maps the
-- rest (`guardIssue`). An event without a limit (`capacity is null`) skips the step entirely: nothing
-- changes for it, lock included.

create or replace function app.event_attendance_guard() returns trigger
  language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_capacity integer;
  v_confirmed integer;
begin
  -- 1. A row never moves: its tenant, event and member are its identity.
  if tg_op = 'UPDATE' and (new.tenant_id is distinct from old.tenant_id
                           or new.event_id is distinct from old.event_id
                           or new.user_id is distinct from old.user_id) then
    raise exception using errcode = '23514', constraint = 'event_attendances_immutable',
                          message = 'attendance_immutable';
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

  -- 3. A checked-in row keeps its status for good (D-204: "once checked in, the answer is locked").
  if tg_op = 'UPDATE' and old.checked_in_at is not null
     and new.status is distinct from old.status then
    raise exception using errcode = '23514', constraint = 'event_attendances_locked',
                          message = 'attendance_locked';
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

  -- 7. A full event takes no new Vou (2026-10-03). See the header: only a move INTO `going` on an
  --    event with a limit is judged, against the OTHER members' confirmed count, under a
  --    transaction-scoped advisory lock on the event.
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
