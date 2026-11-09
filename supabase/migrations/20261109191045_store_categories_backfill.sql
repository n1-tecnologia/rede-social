-- store_categories_backfill (Phase 12.3-09, NOVF-07, NOVF-08; D-691, D-692; T-12.3-06) — the ONE call that gives the
-- stores that already sell something their categories and gives their existing products the category their name tells.
-- The function and its rules are in the previous file, `*_store_categories_functions.sql`; this file holds only the call.
--
-- WHAT IT DOES IN EACH PROJECT: for every tenant that has at least one product in THIS project and no seeded marker, the
-- eight built-in categories are written once and the tenant's uncategorized products are classified by name (no match is
-- 'outros'), without touching `updated_at`. A tenant with no product here gets nothing, so the central project (which
-- holds mirrors of tenants that live elsewhere) and a store enabled later are left to the lazy seed. Running it again is a
-- no-op: the marker row of every seeded tenant is set. The undo handle is documented in the functions file.
--
-- EXPAND-ONLY and fan-out safe (D-696): rows added, an empty column filled, nothing dropped or made required.

do $$
declare
  v_seeded      integer;
  v_categorized integer;
begin
  select r.tenants_seeded, r.products_categorized into v_seeded, v_categorized
    from app.store_categories_initial_load() r;
  raise notice 'store categories: % store(s) seeded, % product(s) categorized by name', v_seeded, v_categorized;
end
$$;
