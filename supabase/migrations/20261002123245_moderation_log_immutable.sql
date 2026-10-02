-- moderation_log_immutable (08-01, MODER-03, D-337, T-08-02) — the hand-written half of the moderation
-- log's APPEND-ONLY guarantee. Its companion `*_moderation_log.sql` is the GENERATED half: the table,
-- its CHECKs, the two keyset indexes and exactly two policies (select, insert — no update, no delete).
--
-- Reversibility: COSTLY. Once production holds audit rows, this table cannot be rewritten without a
-- migration that first drops the trigger below — which is exactly the friction an audit record needs.
--
-- GRANTEES BEFORE THIS MIGRATION (`\dp public.moderation_log` on the local stack, 2026-10-02, RESEARCH
-- A1): the owner `postgres` and Supabase's default privileges' `authenticated` and `service_role`, each
-- with `arwdDxtm` (all of insert, select, update, delete, truncate, references, trigger). `anon` and
-- `api_user` held nothing directly there (`api_user` reaches the table only through `set local role
-- authenticated | service_role`); they are named below anyway because a hosted project's default
-- privileges can differ, and revoking a privilege that was never granted is a no-op.
--
-- THREE LOCKS, ONE PER LANE THAT COULD WRITE:
--  1. the REVOKE takes update, delete and truncate away from every non-owner grantee, so the tenant
--     lane (`authenticated`) and the admin lane (`service_role`) are refused at the privilege check;
--  2. the ROW trigger raises 42501 on any update or delete that still reaches the table — the owner
--     `postgres` keeps its privileges (an owner can always re-grant itself), so the trigger is the
--     guard that stops it, and it would stop a future grant that forgot this file;
--  3. the STATEMENT trigger does the same for truncate, which row triggers never see.
-- `insert` and `select` stay granted to `authenticated` and `service_role`: the RLS policies pin the
-- tenant lane's inserts to its own claims, and the admin lane writes through `recordModerationAction`
-- with values that come from `requireAuth`. `supabase/tests/154-moderation-log.sql` proves every
-- refusal in every lane, the owner's included.

revoke update, delete, truncate on public.moderation_log
  from anon, authenticated, service_role, api_user;--> statement-breakpoint

create or replace function app.moderation_log_immutable() returns trigger
  language plpgsql set search_path = '' as $$
begin
  raise exception 'moderation_log is append-only' using errcode = '42501';
end
$$;--> statement-breakpoint

revoke all on function app.moderation_log_immutable() from public;--> statement-breakpoint

drop trigger if exists moderation_log_no_update_delete on public.moderation_log;--> statement-breakpoint
create trigger moderation_log_no_update_delete
  before update or delete on public.moderation_log
  for each row execute function app.moderation_log_immutable();--> statement-breakpoint

drop trigger if exists moderation_log_no_truncate on public.moderation_log;--> statement-breakpoint
create trigger moderation_log_no_truncate
  before truncate on public.moderation_log
  for each statement execute function app.moderation_log_immutable();
