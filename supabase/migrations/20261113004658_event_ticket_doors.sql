-- event_ticket_doors (Phase 10.1, plan 03; TICK-13, TICK-23; D-742; T-10.1-05, T-10.1-06, T-10.1-22).
-- The two DOORS of a paid event: the online `Entrar` (`app.events_enter`) and the in-person venue code
-- (`app.events_check_in`). In an event that has a payment mapping (`app.event_ticket_mapped`, plan 02,
-- whatever the payments module flag says, D-746) only a member who ALREADY holds a presence passes; everyone
-- else gets the new outcome `ticket_required`.
--
-- WHY. Plan 02 closed the member's own `Vou` and the walk-in write in the guard trigger. But both
-- definers are SECURITY DEFINER and write `walk_in` / `checked_in` rows for the caller, and `Entrar` hands
-- out the meeting URL: without a refusal HERE a member who never paid would walk into a paid event as an
-- online "walk-in" (and see the URL) or guess the venue code. So the rule runs where the URL and the code are.
--
-- THE TWO OUTCOMES, both RETURNED and never raised (Pitfall 1: the service maps them after the transaction):
--   * `events_enter`   -> `ticket_required`, meeting_url NULL (T-10.1-22), in place of `confirm_first` and of
--                         the in-window walk-in. Placed after the cancelled and ended steps (those outcomes
--                         keep winning, as today) and after the member's own row is read.
--   * `events_check_in` -> `ticket_required`, placed after the cancelled and window steps and BEFORE the
--                         advisory lock, the attempts read and the code comparison (T-10.1-06): no guess
--                         is counted and nothing about the code is learned. `cancelled`, `not_open` and
--                         `closed` still come first, as today: they say nothing about the code.
-- The service maps `ticket_required` to the existing refusal code `payment_required` for the check-in route;
-- `Entrar` carries it as a 200 outcome with a null URL.
--
-- WHO PASSES (the HOLDER test). A caller whose own row in this event is `going` (ANY origin: a ticket, a
-- courtesy, or a plain `Vou` made BEFORE the link, assumption A6), `checked_in` or `walk_in` (a presence
-- made before the link keeps working at the doors and is not unmarked). Anyone else (no row, `not_going`)
-- is refused. Holders and every row already present go through the old branches untouched.
--
-- FREE EVENTS ARE UNTOUCHED. For an event with no mapping `v_paid` is false and both functions below behave
-- exactly as before, walk-ins included (D-207, D-208, D-209 keep their meaning; the calendar export is
-- unchanged because the `/eventos/{id}/entrar` URL is still gated at click time).
--
-- BACKSTOP. A direct `walk_in` insert in a mapped event is still `payment_required` through the guard
-- trigger's step 6b (plan 02), so even a definer that forgot this check could not write the row.
--
-- Both functions are re-created from their LATEST bodies (`20260927193130_event_enter_function.sql` and
-- `20260928085140_event_check_in_ceiling.sql`) with the SAME signatures, return types and grants; only the
-- new step is added. Their older headers still document the outcomes, Pitfalls 1 and 2 and the hardening
-- (T-06-29, T-06-38, T-06-43): SECURITY DEFINER, `search_path = ''`, fully qualified names, every statement
-- filtered by `tenant_id = app.tenant_id()` and, for the member's own row, `user_id = app.user_id()`.
--
-- EXPAND-ONLY and re-run safe: two `create or replace function`, no table, column or data is touched.

create or replace function app.events_enter(p_event_id uuid)
returns table (outcome text, meeting_url text, attendance_status text, starts_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_format text;
  v_status text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_answer text;
  v_present timestamptz;
  v_url text;
  v_new_status text;
  v_new_at timestamptz;
begin
  -- 1. No claims, no lane: nothing to enter.
  if v_t is null or v_u is null or p_event_id is null then
    return query select 'not_found'::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- 2. The event, in THIS tenant only, locked against a concurrent cancel or edit.
  select e.format, e.status, e.starts_at, e.ends_at
    into v_format, v_status, v_starts, v_ends
    from public.events e
   where e.id = p_event_id
     and e.tenant_id = v_t
     and e.deleted_at is null
     for share of e;
  if not found or v_format <> 'online' then
    return query select 'not_found'::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- 3. The event's state, then the end of the window.
  if v_status = 'cancelled' then
    return query select 'cancelled'::text, null::text, null::text, v_starts;
    return;
  end if;
  if now() >= v_ends then
    return query select 'ended'::text, null::text, null::text, v_starts;
    return;
  end if;

  -- The member's own row (their answer, and whether they are present already).
  select a.status, a.checked_in_at
    into v_answer, v_present
    from public.event_attendances a
   where a.tenant_id = v_t
     and a.event_id = p_event_id
     and a.user_id = v_u;

  -- 3b. The paid door (10.1, D-742, T-10.1-05, T-10.1-22): in an event that has a payment mapping only a
  --     holder gets on (a `going` row of any origin, or a row already present). Anyone else is refused
  --     with NO URL, before `confirm_first` and before the in-window walk-in.
  if app.event_ticket_mapped(v_t, p_event_id)
     and not (coalesce(v_answer in ('going', 'checked_in', 'walk_in'), false) or v_present is not null) then
    return query select 'ticket_required'::text, null::text, v_answer, v_starts;
    return;
  end if;

  -- 4. Before the window (D-207, D-218): `Vou` is forwarded WITHOUT recording; anyone else is asked
  --    to confirm first and gets no URL.
  if now() < v_starts - interval '1 hour' then
    if v_answer = 'going' or v_present is not null then
      select s.meeting_url
        into v_url
        from public.event_secrets s
       where s.tenant_id = v_t
         and s.event_id = p_event_id;
      if v_url is null then
        return query select 'not_found'::text, null::text, null::text, null::timestamptz;
        return;
      end if;
      return query select 'forward'::text, v_url, v_answer, v_starts;
      return;
    end if;
    return query select 'confirm_first'::text, null::text, v_answer, v_starts;
    return;
  end if;

  -- Inside the window every member gets through; the URL is needed from here on.
  select s.meeting_url
    into v_url
    from public.event_secrets s
   where s.tenant_id = v_t
     and s.event_id = p_event_id;
  if v_url is null then
    return query select 'not_found'::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- 5. Already present: rejoin, without a second record.
  if v_present is not null then
    return query select 'already'::text, v_url, v_answer, v_starts;
    return;
  end if;

  -- 6. The online check-in: ONE upsert. After `Vou` the row becomes `checked_in` (keeping
  --    `responded_at`); with no row or after `Não vou` it is a walk-in (D-216). The guard trigger
  --    fires on it and re-checks the window for every writer. `where a.checked_in_at is null` makes a
  --    racing second enter a no-op: it returns no row, and the re-read answers `already`.
  insert into public.event_attendances as a
         (tenant_id, event_id, user_id, status, checked_in_at, checkin_via)
  values (v_t, p_event_id, v_u, 'walk_in', now(), 'online')
  on conflict (tenant_id, event_id, user_id) do update
     set status = case when a.status = 'going' then 'checked_in' else 'walk_in' end,
         checked_in_at = now(),
         checkin_via = 'online',
         updated_at = now()
   where a.tenant_id = v_t
     and a.user_id = v_u
     and a.checked_in_at is null
  returning a.status, a.checked_in_at
    into v_new_status, v_new_at;

  if v_new_at is null then
    select a.status
      into v_answer
      from public.event_attendances a
     where a.tenant_id = v_t
       and a.event_id = p_event_id
       and a.user_id = v_u;
    return query select 'already'::text, v_url, v_answer, v_starts;
    return;
  end if;

  return query select 'recorded'::text, v_url, v_new_status, v_starts;
end
$$;
--> statement-breakpoint
revoke all on function app.events_enter(uuid) from public;--> statement-breakpoint
grant execute on function app.events_enter(uuid) to authenticated;--> statement-breakpoint

create or replace function app.events_check_in(p_event_id uuid, p_code text)
returns table (outcome text, checked_in_at timestamptz, starts_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_format text;
  v_status text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_present timestamptz;
  v_own text;
  v_failed integer;
  v_window timestamptz;
  v_total integer;
  v_total_since timestamptz;
  v_code text;
  v_rotated timestamptz;
  v_guess text := upper(regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g'));
  v_new_status text;
  v_new_at timestamptz;
begin
  -- 1. No claims, no lane: nothing to check in.
  if v_t is null or v_u is null or p_event_id is null then
    return query select 'not_found'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  -- 2. The event, in THIS tenant only, locked against a concurrent cancel or edit.
  select e.format, e.status, e.starts_at, e.ends_at
    into v_format, v_status, v_starts, v_ends
    from public.events e
   where e.id = p_event_id
     and e.tenant_id = v_t
     and e.deleted_at is null
     for share of e;
  if not found or v_format <> 'in_person' then
    return query select 'not_found'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  -- 3. The event's state and the D-209 window, in that order.
  if v_status = 'cancelled' then
    return query select 'cancelled'::text, null::timestamptz, v_starts;
    return;
  end if;
  if now() < v_starts - interval '1 hour' then
    return query select 'not_open'::text, null::timestamptz, v_starts;
    return;
  end if;
  if now() >= v_ends then
    return query select 'closed'::text, null::timestamptz, v_starts;
    return;
  end if;

  -- 3b. The paid door (10.1, D-742, T-10.1-05, T-10.1-06): in an event that has a payment mapping only
  --     a holder (a `going`, `checked_in` or `walk_in` row of the caller) goes on. Anyone else is refused
  --     HERE, before the advisory lock, the attempts read and the code comparison: no guess is counted
  --     and nothing about the code is learned.
  if app.event_ticket_mapped(v_t, p_event_id) then
    select a.status
      into v_own
      from public.event_attendances a
     where a.tenant_id = v_t
       and a.event_id = p_event_id
       and a.user_id = v_u;
    if v_own is null or v_own not in ('going', 'checked_in', 'walk_in') then
      return query select 'ticket_required'::text, null::timestamptz, v_starts;
      return;
    end if;
  end if;

  -- 4. SERIALISE, then: already present? (CR-01) The advisory TRANSACTION lock on (tenant, event,
  --    member) serialises one member's parallel calls for this event even when no attempts row exists
  --    yet (`for update` alone locks nothing on a first burst). A waiter's later statements start after
  --    the holder committed, so it reads the holder's increment in step 5, and a waiter behind a
  --    successful check-in answers `already` here without spending a guess. Released at commit or
  --    rollback, never held across requests. Then answer a present member with the ORIGINAL stamp.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'app.events_check_in:' || v_t::text || ':' || p_event_id::text || ':' || v_u::text, 0)
  );
  select a.checked_in_at
    into v_present
    from public.event_attendances a
   where a.tenant_id = v_t
     and a.event_id = p_event_id
     and a.user_id = v_u
     and a.checked_in_at is not null;
  if found then
    return query select 'already'::text, v_present, v_starts;
    return;
  end if;

  -- 5. The guess bounds. The venue code and its rotation stamp are read first (the comparison is
  --    still step 6, and nothing here leaves the database). Then, under step 4's lock:
  --    D-217: 5 wrong codes inside the current 15-minute window refuse even the right code;
  --    WR-05: 20 wrong codes against the CURRENT code, across every window, refuse it too, until
  --    the admin regenerates the code (`code_rotated_at` newer than `total_since` restarts the
  --    total). Without it a member's budget grew with the event's length (20 per hour).
  select s.checkin_code, s.code_rotated_at
    into v_code, v_rotated
    from public.event_secrets s
   where s.tenant_id = v_t
     and s.event_id = p_event_id;
  select x.failed_count, x.window_started_at, x.total_failed, x.total_since
    into v_failed, v_window, v_total, v_total_since
    from public.event_checkin_attempts x
   where x.tenant_id = v_t
     and x.event_id = p_event_id
     and x.user_id = v_u
     for update of x;
  if found and (
       (v_failed >= 5 and v_window > now() - interval '15 minutes')
       or (v_total >= 20 and (v_rotated is null or v_total_since >= v_rotated))
     ) then
    return query select 'too_many_attempts'::text, null::timestamptz, v_starts;
    return;
  end if;

  -- 6. The comparison, where the code is. A mismatch is COUNTED and RETURNED (Pitfall 1): the
  --    increment commits with the transaction. An expired window restarts at 1, and so does the
  --    per-code total after a regeneration.
  if v_code is null or v_code is distinct from v_guess then
    insert into public.event_checkin_attempts as x
           (tenant_id, event_id, user_id, failed_count, window_started_at, total_failed, total_since)
    values (v_t, p_event_id, v_u, 1, now(), 1, now())
    on conflict on constraint event_checkin_attempts_pkey do update
       set failed_count = case when x.window_started_at <= now() - interval '15 minutes'
                               then 1 else x.failed_count + 1 end,
           window_started_at = case when x.window_started_at <= now() - interval '15 minutes'
                                    then now() else x.window_started_at end,
           total_failed = case when v_rotated is not null and x.total_since < v_rotated
                               then 1 else x.total_failed + 1 end,
           total_since = case when v_rotated is not null and x.total_since < v_rotated
                              then now() else x.total_since end
     where x.tenant_id = v_t
       and x.event_id = p_event_id
       and x.user_id = v_u;
    return query select 'wrong_code'::text, null::timestamptz, v_starts;
    return;
  end if;

  -- 7. The right code: ONE upsert. After `Vou` the row becomes `checked_in` (keeping
  --    `responded_at`); with no row or after `Não vou` it is a walk-in (D-216). The guard trigger
  --    fires on it and re-checks the window for every writer. `where a.checked_in_at is null` makes
  --    a racing second check-in a no-op: it returns no row, and the re-read answers `already`.
  insert into public.event_attendances as a
         (tenant_id, event_id, user_id, status, checked_in_at, checkin_via)
  values (v_t, p_event_id, v_u, 'walk_in', now(), 'code')
  on conflict (tenant_id, event_id, user_id) do update
     set status = case when a.status = 'going' then 'checked_in' else 'walk_in' end,
         checked_in_at = now(),
         checkin_via = 'code',
         updated_at = now()
   where a.tenant_id = v_t
     and a.user_id = v_u
     and a.checked_in_at is null
  returning a.status, a.checked_in_at
    into v_new_status, v_new_at;

  if v_new_at is null then
    select a.checked_in_at
      into v_present
      from public.event_attendances a
     where a.tenant_id = v_t
       and a.event_id = p_event_id
       and a.user_id = v_u;
    return query select 'already'::text, v_present, v_starts;
    return;
  end if;

  return query select v_new_status, v_new_at, v_starts;
end
$$;
--> statement-breakpoint
revoke all on function app.events_check_in(uuid, text) from public;--> statement-breakpoint
grant execute on function app.events_check_in(uuid, text) to authenticated;
