-- event_opening_reads (Phase 10.2, plan 04; OPEN-05, OPEN-16, OPEN-19, OPEN-23, OPEN-24; D-783, D-789, D-793;
-- T-10.2-01, T-10.2-02, T-10.2-04, T-10.2-05). Hand-written (`--custom`), applied after the generated
-- `*_event_opening.sql` of plan 01 (the two columns this file reads and guards).
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────────
-- D-789: the server blocks the purchase, the screen only reflects it. `app.event_checkout_url` is the ONE SQL
--   place that decides whether a member is handed the purchase link. It now also reads the DATABASE clock: while
--   the event's opening (`events.registration_opens_at`) is still in the future it answers null, from the
--   opening instant on (equal counts as open) and for an event with no opening it answers exactly as before
--   (the stored `https:` link while the payments gateway mode is on, null otherwise). A client clock, a cache or
--   a stale tab can never move this decision: a link a tab already holds is harmless because an early payment
--   still confirms (D-782).
-- Correction 2 of the research: `app.event_sale_ready(p_event)` is a NEW definer that is true iff the sale
--   could be open, IGNORING the clock: a mapping exists for this tenant's live event, the gateway mode is on and
--   the stored link starts with `https:`. It is exactly the old null-ness of the link, so it tells a member
--   nothing the link did not already tell; it exists only so the web can tell a closed sale (`Venda
--   indisponível`: module off, gateway down, no link) from a sale that has not opened yet (`Em breve`), which a
--   single null link cannot say.
-- D-783 and OPEN-16: once a PAID presence exists the date can no longer move, whoever writes it. The rule is a
--   BEFORE UPDATE trigger (`events_opening_guard`) so the service role and a raw SQL session meet it too, not
--   only the API. The lock is the same predicate as `app.event_ticket_lock` and `app.event_ticket_admin.sold`:
--   at least one `event_attendances` row of the event (same tenant) with origin `ticket`. The rule for a
--   refunded sale: a courtesy and a before-the-ticket presence (origin `rsvp` in a paid event) do NOT lock the
--   date; a refunded GOING ticket is DELETED by `app.event_gateway_revoke`, so a fully refunded sale lifts the
--   lock; a refunded CHECKED-IN ticket is kept and flagged and still counts, so it keeps the lock (the safe
--   side, and it only exists within an hour of the start). There is NO insert trigger (a new event has no
--   attendance) and NO advisory lock inside the trigger: the grant takes its advisory lock first and then
--   `for share` on the event row, while `updateEvent` takes the row lock first, so taking the advisory lock here
--   would invert the order and can deadlock; the row lock the UPDATE already holds is what serialises them.
--   Refusal vocabulary: SQLSTATE 23514, constraint `events_opening_locked`, message `opening_locked`.
-- D-793 and OPEN-19: turning the ticket off clears the date. `app.event_ticket_reset(p_event)` (already called
--   by `deleteEventMapping` inside its transaction, after the mapping delete, once the lock has proved
--   `sold = 0`) gains ONE statement that sets `registration_opens_at` to null, so the clear commits or rolls
--   back together with the mapping removal and no kernel code changes. With `sold = 0` the trigger above lets
--   it through; called while a ticket row exists it raises the lock refusal (the backstop).
--
-- ── HARDENING ────────────────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER with `search_path = ''` and fully qualified names. `app.event_checkout_url` and
-- `app.event_sale_ready` PIN `app.tenant_id()` themselves (the owner bypasses RLS), so a lane can never read
-- another tenant's mapping or link whatever event id it passes, and a session with no claims is told nothing.
-- `app.event_ticket_reset` keeps its admin claim and tenant pin. EXECUTE is revoked from PUBLIC and anon and
-- granted to `authenticated` for the three; the trigger function is revoked from PUBLIC, anon and authenticated
-- (a trigger runs without EXECUTE on its function). Names, signatures and grants of the two redefined
-- functions are unchanged, so the read model of 10.1 keeps calling them as it does.
--
-- ── RELEASE ORDER ────────────────────────────────────────────────────────────────────────────────────
-- Expand-only: `create or replace` of two existing functions (same signature), one new function, one new
-- trigger function and one trigger; no table, column, policy or data is touched. The previous API revision
-- keeps calling the same names and gets null only for an event that has an opening, and no event has one until
-- an admin sets it (the API of plan 06).

create or replace function app.event_checkout_url(p_event uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select pp.checkout_url
    from public.payment_products pp
    join public.events e
      on e.id = pp.event_id
     and e.tenant_id = pp.tenant_id
     and e.deleted_at is null
   where pp.tenant_id = app.tenant_id()
     and pp.kind = 'event'
     and pp.event_id = p_event
     and app.payments_gateway_mode()
     and pg_catalog.starts_with(pp.checkout_url, 'https:')
     and (e.registration_opens_at is null or e.registration_opens_at <= pg_catalog.now())
$$;
--> statement-breakpoint
revoke all on function app.event_checkout_url(uuid) from public, anon;--> statement-breakpoint
grant execute on function app.event_checkout_url(uuid) to authenticated;--> statement-breakpoint

create or replace function app.event_sale_ready(p_event uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
           select 1
             from public.payment_products pp
             join public.events e
               on e.id = pp.event_id
              and e.tenant_id = pp.tenant_id
              and e.deleted_at is null
            where pp.tenant_id = app.tenant_id()
              and pp.kind = 'event'
              and pp.event_id = p_event
              and app.payments_gateway_mode()
              and pg_catalog.starts_with(pp.checkout_url, 'https:')
         )
$$;
--> statement-breakpoint
revoke all on function app.event_sale_ready(uuid) from public, anon;--> statement-breakpoint
grant execute on function app.event_sale_ready(uuid) to authenticated;--> statement-breakpoint
