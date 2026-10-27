-- project_token_events_hardening (09.4-02, D-568, CTK-28, T-09.4-05, T-09.4-07) — the hand-written half of the
-- token-audit migration (drizzle-kit cannot model grants or triggers). Applied by the in-house runner right
-- after `project_owner_token`, in ONE transaction. EXPAND-ONLY: it adds a function, a trigger and grants,
-- drops and rewrites nothing.
--
-- CENTRAL SET ONLY. `platform.project_token_events` is the audit of the customer's management token: the KIND
-- of change, the project, an operator label and a closed outcome. It is never applied to a tenant's project
-- (`tenant-set-no-platform.test.ts` and `scripts/db-two-databases.sh --assert-no-platform` prove it). It has
-- no column that can hold a token, a prefix, a hash or a length, so even a leaked row discloses nothing.
--
-- ── 1. EXPOSURE ──────────────────────────────────────────────────────────────────────────────────
-- RLS is ON with ZERO policies (the table definition enables it). On top of that `anon`, `authenticated` and
-- the bare `api_user` hold no privilege; only `service_role`, reached through the platform lane behind the
-- explicit super_admin guard (or the operator's script), reads or writes it. The statements are repeated by
-- name, as the moves hardening does, so the closed state does not depend on which role ran which migration.
revoke all on table platform.project_token_events from public, anon, authenticated;
grant select, insert, update, delete on table platform.project_token_events to service_role;

-- ── 2. THE AUDIT IS APPEND-ONLY (T-09.4-07) ──────────────────────────────────────────────────────
-- Nobody edits an event afterwards, not the service role and not the operator. An UPDATE raises. A DELETE
-- stays possible on purpose: the events cascade away with their project (a deleted project takes its token
-- history with it); no code path deletes a single event.
create or replace function platform.project_token_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'platform.project_token_events is append-only'
    using errcode = 'P0001';
end;
$$;

revoke all on function platform.project_token_events_append_only() from public, anon, authenticated;

create trigger project_token_events_no_update
  before update on platform.project_token_events
  for each row
  execute function platform.project_token_events_append_only();
