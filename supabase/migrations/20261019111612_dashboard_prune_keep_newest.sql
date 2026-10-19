-- dashboard_prune_keep_newest (08.7 code review WR-02) — hand-written (`--custom`), sorted AFTER
-- `*_dashboard_build_no_rewind.sql`; replaces the retention sweep of
-- `20261019035403_dashboard_overview_functions.sql`.
--
-- `app.dashboard_snapshots_prune(p_batch int) returns int`: the same sweep (rows whose
-- `snapshot_day` is more than 8 days before THEIR tenant's local today, oldest first, at most
-- `least(p_batch, 500)` per call, the count deleted returned), with two guards:
--   1. a tenant's NEWEST snapshot is never deleted. Before, a tenant whose builds failed for more
--      than 8 days (the 120 s statement timeout as history grows, an outage) lost its last good
--      snapshot to the hourly sweeper, and the panel turned from a clearly dated stale state
--      ("Atualizado às …") into `preparing`. The sweep now deletes only rows older than the tenant's
--      newest one;
--   2. a tenant whose `timezone` is not a known zone (the column has no CHECK) is skipped, as the
--      kernel's daily dispatcher skips it. Before, `now() at time zone <bad zone>` raised for that
--      row and aborted the cross-tenant sweep for every tenant. The zone is read through the join on
--      `pg_timezone_names`, so the conversion never meets an unknown name whatever the plan order.
--
-- Posture unchanged (T-08.7-25): `security invoker` with an empty search_path, fully qualified
-- names, deliberately CROSS-TENANT, executable by `service_role` ONLY; the revoke/grant pair is
-- re-stated. No statement picks a single row with a LIMIT of one (pgTAP 040). Expand-only.

create or replace function app.dashboard_snapshots_prune(p_batch int)
returns int
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_n int;
begin
  delete from public.dashboard_snapshots s
   using (
     select o.tenant_id, o.snapshot_day
       from public.dashboard_snapshots o
       join public.tenants t on t.id = o.tenant_id
       join pg_catalog.pg_timezone_names z on z.name = t.timezone
      where o.snapshot_day < (now() at time zone z.name)::date - 8
        and o.snapshot_day < (
              select max(x.snapshot_day)
                from public.dashboard_snapshots x
               where x.tenant_id = o.tenant_id)
      order by o.snapshot_day, o.tenant_id
      limit greatest(0, least(coalesce(p_batch, 0), 500))
   ) old
   where s.tenant_id = old.tenant_id
     and s.snapshot_day = old.snapshot_day;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;--> statement-breakpoint
revoke all on function app.dashboard_snapshots_prune(int) from public, anon, authenticated;--> statement-breakpoint
grant execute on function app.dashboard_snapshots_prune(int) to service_role;
