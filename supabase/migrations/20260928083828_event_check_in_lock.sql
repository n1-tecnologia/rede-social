-- event_check_in_lock (06 code review, CR-01) — the D-217 guess bound now holds under CONCURRENCY.
-- Replaces `app.events_check_in(uuid, text)` from `20260927185926_event_check_in_function.sql`
-- (a committed migration is never edited). Everything except steps 4 and 5 is byte for byte the
-- same, and that file's header still documents the function (outcomes, Pitfalls 1 and 2, T-06-29).
--
-- THE BUG. Step 5 read the member's `event_checkin_attempts` row `for update`, and `FOR UPDATE`
-- locks only a row that EXISTS. On a member's first guesses for an event there was none, so N
-- parallel `POST /v1/events/{id}/check-in` calls all passed step 5, all compared their code in
-- step 6, and only met at the counter upsert, which serialised the increments but not the guesses.
-- The first burst per member per event was unbounded (T-06-27 did not hold).
--
-- THE FIX. `pg_advisory_xact_lock` on a 64-bit hash of (tenant, event, member), taken at the top
-- of step 4, before the already-present check and the counter read. It needs no row and writes
-- nothing (a right first code still leaves no attempts row: integration case 3, pgTAP fact 4), and
-- it is released with the transaction (safe on the Supavisor transaction pooler). The key is
-- prefixed with the function name so it cannot meet another advisory user (pg-boss); a 64-bit hash
-- collision would only serialise two unrelated callers for one call.
-- Proved by `apps/api/tests/integration/events-checkin.test.ts` case 8 (20 parallel wrong codes
-- from one member: at most 5 `wrong_code`, the rest `too_many_attempts`, and the right code is
-- then refused) and `supabase/tests/142-event-checkin.sql` fact 21 (a FIRST call, with no attempts
-- row, holds the advisory lock).
--
-- Hardening unchanged (T-06-29): SECURITY DEFINER, `search_path = ''`, fully qualified names
-- (`pg_catalog.` included), every statement filtered by `tenant_id = app.tenant_id()` and, for the
-- member's own rows, `user_id = app.user_id()`. EXECUTE is revoked from PUBLIC and granted to
-- `authenticated` only (`create or replace` keeps the ACL; restated so the file stands alone).

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

  -- 5. The guess bound (D-217): 5 wrong codes inside the current 15-minute window refuse even the
  --    right code. The advisory lock taken in step 4 already serialises this member's calls, so the
  --    read below sees every committed increment; `for update` stays as a second guard on the row.
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
