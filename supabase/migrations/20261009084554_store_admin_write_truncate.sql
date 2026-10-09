-- store_admin_write_truncate (08.2 code review CR-01) — hand-written (`--custom`), applied right after
-- `*_store_admin_write_policies.sql`, which split the tenant-only `FOR ALL` policies of
-- `store_products` and `store_product_communities` into a tenant SELECT and admin-only INSERT,
-- UPDATE and DELETE.
--
-- TRUNCATE is not subject to row-level security, so the policy split alone leaves one way for a lane
-- to empty the links (and with them `app.community_locked_ids()`, opening every paid community of
-- every tenant at once). Supabase's default privileges hand `authenticated` TRUNCATE on every public
-- table; the two ledgers already had it revoked (`*_store_functions.sql`, T-08.2-03). This revokes it
-- from the two tables that define the gate as well. No tenant lane ever truncates: product and link
-- writes are row statements in the admin's lane, and a tenant's rows go with `on delete cascade`.

revoke truncate on public.store_products from authenticated;--> statement-breakpoint
revoke truncate on public.store_product_communities from authenticated;
