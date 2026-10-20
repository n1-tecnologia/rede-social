-- access_allowlist_migrate (09.1-03, D-487) — the ONE-OFF copy of the retiring global
-- `public.email_allowlist` into per-tenant MANUAL rows of `public.access_grants`. Custom migration.
--
-- ── WHAT MIGRATES ───────────────────────────────────────────────────────────────────────────────────
-- For every list row, one MANUAL row per tenant where that e-mail (`lower(btrim(users.email))`) has a
-- live membership (`deleted_at is null`):
--   * `liberado`  -> manual `active`   (the e-mail keeps the door it had)
--   * `bloqueado` -> manual `blocked`  (a block is the only verdict the old list carried besides a
--                                       release; dropping it would silently re-admit someone)
-- `created_at` / `updated_at` are kept. A list row whose e-mail has NO live membership anywhere is
-- counted as `dropped` and not copied (assumption A-P4: a per-tenant record needs a tenant, and the
-- production list is empty). `on conflict do nothing` makes the function idempotent: a second call
-- inserts 0.
--
-- ── WHY A FUNCTION ──────────────────────────────────────────────────────────────────────────────────
-- So pgTAP can run the same logic on a fixture (supabase/tests/175-access-hooks.sql). It is SECURITY
-- INVOKER and owner-only (EXECUTE revoked from public, anon, authenticated, service_role); nothing in the
-- running system calls it after this migration.
--
-- ── RELEASE ORDER ───────────────────────────────────────────────────────────────────────────────────
-- Expand-only. `public.email_allowlist` is NOT dropped, altered or emptied here: the API revision still
-- serving during `supabase db push` reads it. A later CONTRACT release drops the table together with
-- this function (nothing reads the table after plan 03, except this function).

create or replace function public.migrate_email_allowlist_to_access_grants()
returns table (inserted integer, dropped integer)
language plpgsql security invoker set search_path = '' as $$
declare
  v_inserted integer;
  v_dropped  integer;
begin
  insert into public.access_grants (tenant_id, email, source, status, created_at, updated_at)
  select m.tenant_id,
         a.email,
         'manual',
         case a.status when 'liberado' then 'active' else 'blocked' end,
         a.created_at,
         a.updated_at
    from public.email_allowlist a
    join public.users u on lower(btrim(u.email)) = a.email
    join public.memberships m on m.user_id = u.id and m.deleted_at is null
  on conflict (tenant_id, email, status) where source = 'manual' do nothing;
  get diagnostics v_inserted = row_count;

  select count(*)::integer into v_dropped
    from public.email_allowlist a
   where not exists (
           select 1
             from public.users u
             join public.memberships m on m.user_id = u.id and m.deleted_at is null
            where lower(btrim(u.email)) = a.email);

  return query select v_inserted, v_dropped;
end
$$;
--> statement-breakpoint
revoke all on function public.migrate_email_allowlist_to_access_grants()
  from public, anon, authenticated, service_role;
--> statement-breakpoint
comment on function public.migrate_email_allowlist_to_access_grants() is
  'One-off (09.1-03, D-487): copies public.email_allowlist into per-tenant manual access_grants rows (liberado -> active, bloqueado -> blocked) for every tenant where the e-mail has a live membership; returns (inserted, dropped). Idempotent. Dropped with the table by a later contract release.';
--> statement-breakpoint
do $$
declare
  v_inserted integer;
  v_dropped  integer;
begin
  select r.inserted, r.dropped into v_inserted, v_dropped
    from public.migrate_email_allowlist_to_access_grants() r;
  raise notice 'email_allowlist -> access_grants: % manual rows inserted, % list rows without a live membership dropped',
    v_inserted, v_dropped;
end
$$;
