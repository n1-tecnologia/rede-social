-- notifications_prune (07-04, D-231) — the 90-day retention of `public.notifications`, run by the
-- kernel's EXISTING hourly sweeper (`kernel.media-sweep-orphans`), which executes every name a module
-- manifest declares in `sweepFunctions` as `select app.<name>(<batch>)` through the admin lane
-- (`withAdminTx`, `set local role service_role`). The kernel never names this table (MOD-02); the
-- notifications module declares `sweepFunctions: ['notifications_prune']`.
--
-- THE CONTRACT: delete AT MOST `p_batch` rows (clamped to 1..5000), oldest first, and return how many
-- were deleted. The sweeper repeats the call while a full batch comes back, at most 20 times per run
-- (T-07-25), so a backlog drains over a few hours instead of in one long transaction.
--
-- THE BOUNDARY: `created_at < now() - interval '90 days'`, with the database clock. A row created 90
-- days and 1 minute ago goes, a row created 89 days and 23 hours ago stays (NOTIF-02 boundary, pgTAP 151
-- fact 11). Every kind is pruned at 90 days, stories included: an expired story's row keeps routing to
-- Início's "Este story expirou." notice until then (UI-D-254).
--
-- SECURITY INVOKER, granted to `service_role` ONLY (planning decision 4). The admin lane already runs
-- as `service_role` (bypassrls), so a definer would add nothing; and no tenant lane may call it, since
-- the prune is deliberately CROSS-TENANT (T-07-26: `authenticated` gets 42501, pgTAP 151 fact 11). The
-- inner select is served by `notifications_created_idx` (the generated companion migration), the one
-- documented exception to the tenant-first index rule.

create or replace function app.notifications_prune(p_batch int)
returns int
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_n int;
begin
  delete from public.notifications
   where id in (
     select id
       from public.notifications
      where created_at < now() - interval '90 days'
      order by created_at
      limit greatest(1, least(coalesce(p_batch, 1), 5000))
   );
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
--> statement-breakpoint
revoke all on function app.notifications_prune(int) from public, authenticated;--> statement-breakpoint
grant execute on function app.notifications_prune(int) to service_role;
