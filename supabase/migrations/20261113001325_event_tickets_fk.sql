-- Phase 10.1 (D-740, D-744, TICK-01): the composite foreign key of an event ticket mapping.
--
-- WHY HAND SQL: `payment_products` lives in the kernel and the kernel cannot import the events module's
-- schema (MOD-02), so drizzle-kit has no reference to emit. The key is composite on purpose:
-- `(tenant_id, event_id)` references `public.events (tenant_id, id)`, so a mapping can only ever name an
-- event of ITS OWN tenant (T-10.1-01), and it dies with the event (on delete cascade, no trigger).
--
-- EXPAND-ONLY: one `add constraint` and nothing else. Every existing mapping has a null `event_id`,
-- so every existing row satisfies the key.
--
-- RE-RUN SAFE (EP-43): the only statement runs inside a catalog-guarded block, so an interrupted
-- fan-out that applies this file a second time does nothing. The Supabase ledger also runs it once
-- per project.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'payment_products_event_fk'
       and conrelid = 'public.payment_products'::regclass
  ) then
    alter table public.payment_products
      add constraint payment_products_event_fk
      foreign key (tenant_id, event_id)
      references public.events (tenant_id, id)
      on delete cascade;
  end if;
end
$$;
