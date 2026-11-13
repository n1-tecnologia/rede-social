-- event_ticket_reads (Phase 10.1, plan 04; TICK-14, TICK-16, TICK-21; D-746, D-749, D-753; T-10.1-01,
-- T-10.1-11). Hand-written (`--custom`), applied after `*_event_courtesy_definers.sql` in this plan.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────────
-- The member page, the Eventos list and the admin's ticket card need four facts about a paid event, and
-- none of them may be read from `payment_products` directly: that table is admin-only (the purchase link
-- and the gateway's product id are never handed to a member, T-10.1-11). So each fact is a small definer,
-- the shape of `app.payments_checkout_url` and `app.store_product_name_for` (the store's seam functions):
--   app.event_is_paid(p_event) returns boolean
--     true iff a mapping exists for THIS tenant's event, WHATEVER the `payments` module flag says (D-746: a
--     module turned off must never reopen the free Vou). Any role of the tenant may ask (a member needs it
--     to know whether to show a purchase button or the instant Vou).
--   app.event_checkout_url(p_event) returns text
--     the stored link of the event's mapping, only while `app.payments_gateway_mode()` is true (the module
--     enabled AND a gateway connected) and only if the stored link starts with `https:`; null otherwise.
--     Module off, gateway disconnected, no link stored, a non-https value (the table CHECK already refuses
--     one: this is the second lock) and an event that is not this tenant's all fold to null (TICK-16).
--   app.event_ticket_admin(p_event) returns (external_product_id, checkout_url, gateway_open, sold)
--     the admin's card: the gateway's product id, the stored link AS STORED, whether the gateway is open, and
--     the number of rows of origin `ticket` (a refunded checked-in row still counts, the safe side). Requires
--     the `admin_tenant` claim, checked INSIDE (no row otherwise), and answers with the module off (D-753).
--   app.event_title_for(p_tenant, p_event) returns text
--     the title for the Eventos recentes list, pinned to the tenant argument; null for a deleted or foreign
--     event. `service_role` only, like `app.store_product_name_for` (the list runs in the admin lane).
--
-- ── HARDENING ────────────────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER with `search_path = ''` and fully qualified names. The first three PIN `app.tenant_id()`
-- themselves (the owner bypasses RLS), so a lane can never read another tenant's mapping, link or count
-- whatever event id it passes, and a session with no claims is told nothing. EXECUTE is revoked from PUBLIC
-- and anon and granted to `authenticated` for the first three; `app.event_title_for` is revoked from public,
-- anon and authenticated and granted to `service_role` only.
--
-- ── RELEASE ORDER ────────────────────────────────────────────────────────────────────────────────────
-- Expand-only: four new functions; no table, column, constraint or data is touched.

create or replace function app.event_is_paid(p_event uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
           select 1
             from public.payment_products pp
            where pp.tenant_id = app.tenant_id()
              and pp.kind = 'event'
              and pp.event_id = p_event
         )
$$;
--> statement-breakpoint
revoke all on function app.event_is_paid(uuid) from public, anon;--> statement-breakpoint
grant execute on function app.event_is_paid(uuid) to authenticated;--> statement-breakpoint

create or replace function app.event_checkout_url(p_event uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select pp.checkout_url
    from public.payment_products pp
   where pp.tenant_id = app.tenant_id()
     and pp.kind = 'event'
     and pp.event_id = p_event
     and app.payments_gateway_mode()
     and pg_catalog.starts_with(pp.checkout_url, 'https:')
$$;
--> statement-breakpoint
revoke all on function app.event_checkout_url(uuid) from public, anon;--> statement-breakpoint
grant execute on function app.event_checkout_url(uuid) to authenticated;--> statement-breakpoint

create or replace function app.event_ticket_admin(p_event uuid)
returns table (external_product_id text, checkout_url text, gateway_open boolean, sold integer)
language sql stable security definer set search_path = '' as $$
  select pp.external_product_id,
         pp.checkout_url,
         app.payments_gateway_mode(),
         (select pg_catalog.count(*)::integer
            from public.event_attendances a
           where a.tenant_id = pp.tenant_id
             and a.event_id = pp.event_id
             and a.origin = 'ticket')
    from public.payment_products pp
   where app.tenant_role() = 'admin_tenant'
     and pp.tenant_id = app.tenant_id()
     and pp.kind = 'event'
     and pp.event_id = p_event
$$;
--> statement-breakpoint
revoke all on function app.event_ticket_admin(uuid) from public, anon;--> statement-breakpoint
grant execute on function app.event_ticket_admin(uuid) to authenticated;--> statement-breakpoint

create or replace function app.event_title_for(p_tenant uuid, p_event uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select e.title
    from public.events e
   where e.id = p_event
     and e.tenant_id = p_tenant
     and e.deleted_at is null
$$;
--> statement-breakpoint
revoke all on function app.event_title_for(uuid, uuid) from public, anon, authenticated;--> statement-breakpoint
grant execute on function app.event_title_for(uuid, uuid) to service_role;
