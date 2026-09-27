-- event_attendance_guard (06-03) — the database's refusal, for EVERY writer, of an attendance write
-- the event no longer allows (D-204, D-209, D-214, D-216). Its companion
-- `20260927154326_event_attendances.sql` is the GENERATED half (the table, its CHECKs, the composite
-- FK, the two chip indexes and the three policies); this file is everything drizzle-kit cannot model.
--
-- WHY A TRIGGER AND NOT A CHECK (planning decision 1). "No RSVP from `starts_at` on" compares a row
-- of `event_attendances` with a row of `events`, and a CHECK cannot read another table. The UI hiding
-- the control is not enough either (D-204): the API, a psql session, a backfill and the SECURITY
-- DEFINER check-in functions of 06-05/06-06 all write this table, and every one of them must meet the
-- same rule. A BEFORE INSERT OR UPDATE row trigger is the one place all of them pass through.
-- Postgres fires BEFORE INSERT row triggers BEFORE the ON CONFLICT arbiter, so the guard sees every
-- attempted RSVP tuple, including one that then conflicts and becomes an update.
--
-- WHY `FOR SHARE` ON THE EVENT ROW. An RSVP racing an admin cancel (or an edit that moves
-- `starts_at`) must serialise on the event: the cancel's UPDATE holds the row lock, the guard's
-- `FOR SHARE` waits for it, and under READ COMMITTED it then re-reads the COMMITTED row, so the answer
-- meets the cancelled event and is refused (EVENT-01 concurrency, RSVP-versus-cancel half). Two
-- concurrent RSVPs both take SHARE and never wait on each other. There is no read-then-write window.
--
-- WHY THE COUNTS ARE NOT MAINTAINED HERE (planning decision 3, Pitfall 3). A counter on `events`
-- updated inside this transaction would upgrade the SHARE lock the guard already holds, and two
-- concurrent RSVPs on one event would deadlock. The counts are read-time aggregates over
-- `event_attendances_tenant_event_status_idx`.
--
-- WHY THE REFUSALS LOOK LIKE CHECK VIOLATIONS. Every raise is SQLSTATE 23514 (23503 for the missing
-- event) with a `constraint` name, so the service maps them exactly as it maps a real CHECK: it walks
-- the driver's cause chain for `code` + `constraint_name` (`guardIssue` in
-- `packages/modules/events/server/service.ts`). The names, in the order the guard tests them:
--   1. `event_attendances_immutable`      an UPDATE that moves a row to another tenant/event/user;
--   2. `event_attendances_event_visible`  (23503) no live event with this id in this tenant -> a bare
--                                          404, never a per-cause code (D-23);
--   3. `event_attendances_locked`         a status change on a row that has checked in
--                                          (-> `attendance_locked`);
--   4. `event_attendances_event_active`   any write on a cancelled event (-> `cancelled`, D-201);
--   5. `event_attendances_rsvp_open`      `going`/`not_going` at or after `starts_at`
--                                          (-> `rsvp_closed`). `>=` on `timestamptz`: an event whose
--                                          `starts_at = now()` is already closed;
--   6. `event_attendances_checkin_window` a check-in outside `[starts_at - 1 hour, ends_at)` (D-209),
--                                          with message `checkin_not_open` before and
--                                          `checkin_closed` after.
--
-- WHY THE FUNCTION DOES NOT RUN WITH THE DEFINER'S RIGHTS (the `app.community_post_stats()` posture):
-- it reads the event in the WRITER's own lane. A member lane already sees its tenant's events, and
-- `events_tenant_isolation` is `for all`, which is what `FOR SHARE` (an UPDATE-privilege lock) needs.
-- The explicit `tenant_id = new.tenant_id` predicate means a row can only be judged against an event of
-- its own tenant, whichever lane writes it. `set search_path = ''` plus fully qualified names keeps the
-- function from being hijacked by a schema-shadowing attack.
--
-- Proved by `supabase/tests/141-event-attendances.sql` (the boundary pair, every refusal with its
-- positive control) and `apps/api/tests/integration/events-rsvp.test.ts` (the held-cancel race).

create or replace function app.event_attendance_guard() returns trigger
  language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
begin
  -- 1. A row never moves: its tenant, event and member are its identity.
  if tg_op = 'UPDATE' and (new.tenant_id is distinct from old.tenant_id
                           or new.event_id is distinct from old.event_id
                           or new.user_id is distinct from old.user_id) then
    raise exception using errcode = '23514', constraint = 'event_attendances_immutable',
                          message = 'attendance_immutable';
  end if;

  -- 2. The event, read in THIS tenant and locked against a concurrent cancel or edit.
  select e.status, e.starts_at, e.ends_at
    into v_status, v_starts_at, v_ends_at
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

  return new;
end
$$;
--> statement-breakpoint
create trigger event_attendances_guard
  before insert or update on public.event_attendances
  for each row execute function app.event_attendance_guard();
