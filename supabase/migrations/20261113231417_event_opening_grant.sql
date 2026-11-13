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
