-- event_check_in_ceiling (06 code review, WR-05) — a per-code ceiling on one member's wrong guesses.
-- Replaces `app.events_check_in(uuid, text)` from `20260928083828_event_check_in_lock.sql`
-- (CR-01; its advisory lock in step 4 is kept as is). The companion
-- `20260928085138_event_checkin_attempts_total.sql` adds the two columns. The header of
-- `20260927185926_event_check_in_function.sql` still documents the outcomes, Pitfalls 1 and 2 and
-- the T-06-29 hardening; only steps 5 and 6 change here.
--
-- THE GAP. The D-217 bound (5 wrong codes per 15-minute window) applies over the whole check-in
-- window `[starts_at - 1h, ends_at)`, and nothing caps an event's length: one member on the seed's
-- 72-hour event had about 1,460 guesses (0.16% of the 923,521 codes).
--
-- THE CEILING. At most 20 wrong codes per member per event against the CURRENT code (four full
-- windows' worth, so a member who mistypes is never refused by it before the 15-minute bound has
-- already stopped them three times). Past it, `too_many_attempts` even with the right code, until the
-- admin taps "Gerar novo código": `code_rotated_at` then post-dates `total_since`, and the next guess
-- restarts the total at 1. That is also the recovery path for a member who hit it by accident (the
-- staff regenerates the code, which a suspected brute force calls for anyway). The ceiling is
-- `EVENT_CHECKIN_MAX_FAILED_PER_CODE` in the contracts (a mirror for copy and tests; this function is
-- the only enforcer, like the D-217 literals).
--
-- NOT covered here (a product decision, recorded in 06-REVIEW-FIX.md): the attempt budget still
-- grows with the NUMBER of accounts (self-service signup gives each one its own 20). A per-event
-- aggregate refusal would let about ten throwaway accounts lock every legitimate member out at the
-- door, so it needs a product call (RSVP-gated check-in, a longer code for long events, or an
-- admin-visible alarm) rather than a silent limit.
--
-- Hardening unchanged (T-06-29): SECURITY DEFINER, `search_path = ''`, fully qualified names, every
-- statement filtered by `tenant_id = app.tenant_id()` and, for the member's own rows,
-- `user_id = app.user_id()`; EXECUTE revoked from PUBLIC and granted to `authenticated` only.

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
