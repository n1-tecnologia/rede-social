-- event_check_in_function (06-05) — EVENT-04 in person: the member at the venue types the code the
-- organiser reads aloud, and becomes present (D-208, D-209, D-216, D-217). Its companion
-- `20260927185909_event_checkin_attempts.sql` is the GENERATED half (the guess counter table).
--
-- WHY THIS FUNCTION, ALONE IN THE MODULE, RUNS AS ITS OWNER (SECURITY DEFINER). The member must
-- prove knowledge of a secret their own lane cannot read: `event_secrets` is visible to the
-- `admin_tenant` lane only (`event_secrets_staff_all`, D-217), and the member lane cannot write
-- `checked_in` / `walk_in` (`event_attendances_self_rsvp_*` admit `going`/`not_going` only, T-06-11)
-- nor the guess counter (no write policy at all, T-06-30). So the comparison runs WHERE THE CODE IS,
-- inside Postgres, and the code never leaves the database on this path (T-06-31).
--
-- PITFALL 2 (T-06-28): the owner is `postgres`, which has `rolbypassrls`. RLS protects NOTHING in
-- here, so EVERY statement below filters `tenant_id = v_t` (`app.tenant_id()`) and, where the row is
-- the member's own, `user_id = v_u` (`app.user_id()`). A missing predicate would read or write another
-- tenant's rows. `supabase/tests/142-event-checkin.sql` fact 10 calls this function from tenant A's
-- lane with tenant B's event id and asserts `not_found` AND that nothing of B's was written, with A's
-- own event as the positive control in the same block.
--
-- PITFALL 1 (T-06-27): a business refusal is RETURNED as an outcome, never raised. A `raise` would
-- roll back the transaction, and with it the `event_checkin_attempts` increment, so the guess bound
-- would never trip. The service (`checkInEvent`) returns the row out of `withTenantTx` and throws its
-- 409 only after the transaction committed. Outcomes:
--   `checked_in`        the right code, after a `Vou` (`going`): `responded_at` is kept (D-216);
--   `walk_in`           the right code with no row, or after `Não vou` (D-216);
--   `already`           the member was already present: the ORIGINAL stamp, and no guess is spent;
--                       also the loser of two racing check-ins (planning decision 2);
--   `wrong_code`        a mismatch, counted in `event_checkin_attempts`;
--   `too_many_attempts` 5 wrong codes within 15 minutes, answered EVEN WITH THE RIGHT CODE;
--   `not_open`          before `starts_at - 1 hour` (D-209);
--   `closed`            from `ends_at` on (D-209);
--   `cancelled`         a cancelled event (D-201);
--   `not_found`         no live IN-PERSON event of this tenant with this id, or no claims (an online
--                       event is checked in by `Entrar`, 06-06, never by a code).
-- The refusals are tested in this order (cancelled, then the window), and `already` comes before the
-- guess counter, so a present member re-submitting spends nothing.
--
-- The window is ALSO the guard trigger's (`app.event_attendance_guard`, 06-03), which fires on the
-- attendance upsert below and refuses the same window for every writer. The two cannot disagree in
-- practice: `now()` is the transaction timestamp, and the event row is read `FOR SHARE` here first.
--
-- The input is normalised HERE (uppercase; whitespace and hyphens stripped), so `k7-qm`, ` K7QM `
-- and `K7QM` are the same guess. The 31-symbol alphabet has no lowercase, so uppercasing loses nothing.
--
-- Hardening (T-06-29): `set search_path = ''` and fully qualified names (the
-- `app.ensure_member_profile` precedent), `revoke all … from public` (PUBLIC holds EXECUTE on every new
-- function by default), and `grant execute … to authenticated` only (the tenant lane's role).
-- `#variable_conflict use_column` plus table aliases keep the OUT columns (`checked_in_at`,
-- `starts_at`) from shadowing the tables' own columns.

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
  v_code text;
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

  -- 4. Already present? Answer with the ORIGINAL stamp before spending a guess.
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

  -- 5. The guess bound (D-217): 5 wrong codes inside the current 15-minute window refuse even the
  --    right code. `for update` serialises one member's parallel guesses on their own row.
  select x.failed_count, x.window_started_at
    into v_failed, v_window
    from public.event_checkin_attempts x
   where x.tenant_id = v_t
     and x.event_id = p_event_id
     and x.user_id = v_u
     for update of x;
  if found and v_failed >= 5 and v_window > now() - interval '15 minutes' then
    return query select 'too_many_attempts'::text, null::timestamptz, v_starts;
    return;
  end if;

  -- 6. The comparison, where the code is. A mismatch is COUNTED and RETURNED (Pitfall 1): the
  --    increment commits with the transaction. An expired window restarts at 1.
  select s.checkin_code
    into v_code
    from public.event_secrets s
   where s.tenant_id = v_t
     and s.event_id = p_event_id;
  if v_code is null or v_code is distinct from v_guess then
    insert into public.event_checkin_attempts as x
           (tenant_id, event_id, user_id, failed_count, window_started_at)
    values (v_t, p_event_id, v_u, 1, now())
    on conflict on constraint event_checkin_attempts_pkey do update
       set failed_count = case when x.window_started_at <= now() - interval '15 minutes'
                               then 1 else x.failed_count + 1 end,
           window_started_at = case when x.window_started_at <= now() - interval '15 minutes'
                                    then now() else x.window_started_at end
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
