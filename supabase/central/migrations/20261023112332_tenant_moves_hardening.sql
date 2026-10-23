-- tenant_moves_hardening (09.2-23, D-534, D-535, D-536, DBT-34, DBT-48) — the hand-written half of the
-- tenant-move migration (drizzle-kit cannot model grants or triggers). Applied by the in-house runner right
-- after `tenant_moves`, in ONE transaction. EXPAND-ONLY: it adds a function, a trigger and grants, drops and
-- rewrites nothing.
--
-- CENTRAL SET ONLY. `platform.tenant_moves` and `platform.tenant_move_events` are the state machine and the
-- audit trail of the operator's move tool. They are never applied to a tenant's project (the tenant set has no
-- reference to schema `platform`; `tenant-set-no-platform.test.ts` and pgTAP over `rede_tenant_b` prove it).
--
-- ── 1. EXPOSURE ──────────────────────────────────────────────────────────────────────────────────
-- Both tables have RLS ON with ZERO policies (the table definitions enable it). On top of that `anon`,
-- `authenticated` and the bare `api_user` hold no privilege; only `service_role`, reached through the
-- platform lane behind the explicit super_admin guard (or the operator's script), reads or writes them. The
-- hardening migration of the registry already set default privileges for tables created later in this schema;
-- the statements are repeated by name so the closed state does not depend on which role ran which migration.
revoke all on table platform.tenant_moves from public, anon, authenticated;
revoke all on table platform.tenant_move_events from public, anon, authenticated;
grant select, insert, update, delete on table platform.tenant_moves to service_role;
grant select, insert, update, delete on table platform.tenant_move_events to service_role;

-- ── 2. THE AUDIT IS APPEND-ONLY (T-09.2-103) ─────────────────────────────────────────────────────
-- A move's events are its record: kind, counts, table names and codes. Nobody edits an event afterwards, not
-- the service role and not the operator. An UPDATE raises. A DELETE stays possible on purpose: the events
-- cascade away with their move, and the move cascades away with its tenant (a deleted tenant takes its
-- history with it); no code path deletes a single event.
create or replace function platform.tenant_move_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'platform.tenant_move_events is append-only'
    using errcode = 'P0001';
end;
$$;

revoke all on function platform.tenant_move_events_append_only() from public, anon, authenticated;

create trigger tenant_move_events_no_update
  before update on platform.tenant_move_events
  for each row
  execute function platform.tenant_move_events_append_only();
