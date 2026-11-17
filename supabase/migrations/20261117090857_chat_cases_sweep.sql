-- chat_cases_sweep (Phase 12.4 plan 04, CASE-13, CASE-12, CASE-18, CASE-23; D-807, D-844, D-810; T-12.4-17..20) — the
-- automatic close of a support case left `resolved` for 7 days, hand-written (`--custom`): drizzle-kit cannot model
-- functions. It rides the kernel's EXISTING hourly sweeper (`kernel.media-sweep-orphans`), which executes every name a
-- module manifest declares in `sweepFunctions` as `select app.<name>(<batch>)` through the admin lane (`withAdminTx`,
-- `set local role service_role`). The chat manifest declares `sweepFunctions: ['chat_cases_auto_close']`; no new queue and
-- no new job name exist (D-844).
--
-- THE CONTRACT. Close AT MOST `p_batch` cases (clamped to 1..5000), the one resolved LONGEST ago first with the
-- conversation id as tiebreak, and return how many were closed. The kernel repeats the call while a full batch comes back,
-- at most 20 times per run, so a backlog drains over a few hours. The cadence is hourly, so a case closes between 7 days
-- and 7 days 1 hour after `resolved_at`.
--
-- THE 7 DAYS. They are the ONE `interval '7 days'` literal below (D-807: a platform rule, never a tenant setting, never a
-- second copy in TypeScript); `apps/api/tests/integration/chat-cases-sweep.test.ts` reads it back out of
-- `pg_get_functiondef` and pins it. The comparison is less-than-or-equal on the transaction clock: a case resolved EXACTLY
-- 7 days ago closes, one resolved 7 days minus a minute ago does not (EP-039).
--
-- WHY `security definer`. The close publishes the ids-only `chat.case` signal (through `app.chat_case_signal`, the same
-- helper the staff definers use, so the topics cannot drift) and `realtime.send` only works for the owner (the owner,
-- `postgres`, is `rolbypassrls`, and may insert into `realtime.messages`; see `20260930190229_chat_functions.sql`). The
-- consequence is that RLS protects nothing inside the body, so the tenant scope is spelled out: the function is CROSS-TENANT
-- by design (one sweep per project covers every tenant, the T-07-26 posture of `notifications_prune`), and each UPDATE and
-- each event row pins the row's OWN `tenant_id` (T-12.4-17). Executable by `service_role` ONLY: `authenticated`, `anon` and
-- `public` get no grant (T-12.4-18).
--
-- IDEMPOTENT AND SILENT. The predicate is the state, so a second run finds nothing and writes nothing. The function writes
-- NO notification row and enqueues NO push (D-808: closing is silent for the member, and no countdown exists anywhere). A
-- member message on a resolved case reopens it (plan 02's trigger) and so takes it out of the sweep's reach; a row such a
-- message, or a staff action, is updating is skipped by `skip locked` and re-evaluated the next hour. A message that
-- waits behind the sweep sees `closed` and is refused CS004, and the API retries into a NEW case (D-801).
--
-- THE HISTORY ROW has NO actor (`actor_user_id` null), from `resolved` to `closed`: the close is the system's, and the
-- timeline shows it as such (D-810). The case row keeps its owner; `resolved_at` is cleared and `closed_at` set in ONE update,
-- so the coherence CHECK never sees an in-between row. Both instants are one `clock_timestamp()` per call, like the staff
-- definers of plan 03.
--
-- THE INDEX. The sweep reads resolved cases across every tenant; `chat_conversations_resolved_sweep_idx` on
-- `(resolved_at) where state = 'resolved'` (plan 01) serves it, the one documented non-tenant-first index of the table.

create or replace function app.chat_cases_auto_close(p_batch int)
returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_n int := 0;
  r record;
begin
  for r in
    select c.id, c.tenant_id, c.created_by_user_id
      from public.chat_conversations c
     where c.kind = 'support'
       and c.state = 'resolved'
       and c.resolved_at <= now() - interval '7 days'
     order by c.resolved_at, c.id
     limit greatest(1, least(coalesce(p_batch, 1), 5000))
       for update skip locked
  loop
    -- The state is restated and the row's own tenant pinned: the row was locked above, so no message or staff action can
    -- have moved it, and a write can never leave its tenant.
    update public.chat_conversations
       set state = 'closed', closed_at = v_now, resolved_at = null
     where id = r.id and tenant_id = r.tenant_id and state = 'resolved';
    if found then
      insert into public.chat_case_events (tenant_id, conversation_id, kind, actor_user_id, from_state, to_state, created_at)
      values (r.tenant_id, r.id, 'closed', null, 'resolved', 'closed', v_now);
      perform app.chat_case_signal(r.tenant_id, r.id, r.created_by_user_id);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;
--> statement-breakpoint
revoke all on function app.chat_cases_auto_close(int) from public, authenticated;--> statement-breakpoint
grant execute on function app.chat_cases_auto_close(int) to service_role;
