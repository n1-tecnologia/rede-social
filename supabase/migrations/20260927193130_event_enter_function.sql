-- event_enter_function (06-06) — EVENT-04 online: for an online event, following `Entrar` IS the
-- check-in (D-210). The web's `GET /eventos/{id}/entrar` route handler calls
-- `POST /v1/events/{id}/enter`, which calls this function, and the member lands in the meeting through
-- a 303 whose `Location` is the URL returned here. There is no generated half: nothing new is stored.
--
-- D-207, THE GATE, DECIDED AT THE INSTANT OF THE TAP AND INSIDE POSTGRES. The meeting URL lives in
-- `event_secrets`, which only the `admin_tenant` lane can read (`event_secrets_staff_all`, D-217), and
-- the member lane cannot write `checked_in` / `walk_in` (`event_attendances_self_rsvp_*` admit
-- `going`/`not_going` only, T-06-11). So the rule and the write run WHERE THE URL IS, and the URL
-- leaves the database ONLY on the three outcomes that let the member through (`forward`, `recorded`,
-- `already`). Every refusal returns a NULL `meeting_url` (T-06-35), which
-- `supabase/tests/142-event-checkin.sql` asserts outcome by outcome.
--
-- Outcomes, tested in this order:
--   `not_found`      no claims; or no live ONLINE event of this tenant with this id (an in-person
--                    event is checked in by its venue code, 06-05, never by `Entrar`);
--   `cancelled`      a cancelled event (D-201);
--   `ended`          from `ends_at` on (`>=`, the D-209 closing edge);
--   `forward`        BEFORE the window (`now() < starts_at - 1 hour`) and the member said `Vou`
--                    (`going`): the URL, and NOTHING is recorded (D-218's recorded default: entering
--                    early works but does not count; the outline `Entrar` of UI-D-209 says so). A member
--                    already present (an admin moved the event later after they checked in) is
--                    forwarded the same way;
--   `confirm_first`  before the window with any other answer (none, `not_going`): no URL (D-207);
--   `already`        inside the window, the member was already present: the URL again (rejoin) and
--                    their recorded status, without a second record; also the loser of two racing
--                    enters (the `checked_in_at is null` arbiter, T-06-42);
--   `recorded`       inside the window: ONE upsert, `checked_in` after a `Vou` (keeping
--                    `responded_at`) or `walk_in` otherwise (D-216), with `checkin_via = 'online'`.
-- `attendance_status` is the member's status after the call (null when there is none), so the service
-- can emit `event.checked_in` with `walkIn` without a second read; `starts_at` completes that payload.
--
-- D-218, WHY A GET CAN SAFELY LEAD HERE. The web route is a plain GET because a calendar click must
-- count in one tap (D-210/D-211). The side effect is fenced in layers: plain anchors with
-- `data-no-prefetch` (never a framework link), SW navigations `NetworkOnly`, `SameSite=Lax` session
-- cookies, a `Sec-Purpose: prefetch` 204 in the route handler, and the API side is a POST. And here:
-- nothing is recorded OUTSIDE the window, whatever the caller.
--
-- PITFALL 2 (T-06-38): the owner is `postgres`, which has `rolbypassrls`. RLS protects NOTHING in here,
-- so EVERY statement below filters `tenant_id = v_t` (`app.tenant_id()`) and, where the row is the
-- member's own, `user_id = v_u` (`app.user_id()`). `142-event-checkin.sql` calls this function from
-- tenant A's lane with tenant B's online event id and asserts `not_found` AND that B's rows are
-- unchanged, with A's own event as the positive control in the same block.
--
-- PITFALL 1: nothing is raised for a business refusal (the 06-05 posture). The outcome is RETURNED,
-- and the service maps it only after `withTenantTx` resolved.
--
-- The window is ALSO the guard trigger's (`app.event_attendance_guard`, 06-03), which fires on the
-- upsert below. The two cannot disagree: `now()` is the transaction timestamp, and the event row is
-- read `FOR SHARE` here first.
--
-- Hardening (T-06-43): `set search_path = ''` and fully qualified names, `revoke all … from public`,
-- `grant execute … to authenticated` only. `#variable_conflict use_column` plus table aliases keep the
-- OUT columns (`meeting_url`, `starts_at`) from shadowing the tables' own columns.

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
grant execute on function app.events_enter(uuid) to authenticated;
