-- notifications_push_withdrawn (07 review B-WR-02) — "was this notification retracted after its push
-- was queued?", asked by `notifications.push-send` right before it sends.
--
-- The push body is rendered at fan-out time and travels in the job, which can wait (a 30 s / 2 min /
-- 8 min retry) after the post, comment or story it quotes was deleted and its bell rows were blanked
-- by `app.notifications_retract`. The job therefore re-checks at send time: if any of its recipients'
-- rows with this `dedupe_key` is marked `{"removed": true}`, the push is withdrawn and nothing is sent.
-- Push-only kinds (chat) write no row and answer false: chat has no delete path in V1.
--
-- WHY A SECURITY DEFINER FUNCTION (the `notifications_retract` rule restated): the table's policies
-- are owner-only, and the push worker's system lane owns no row, so a lane SELECT would see nothing.
-- The owner bypasses RLS, so the statement pins `tenant_id = app.tenant_id()` itself; a lane without a
-- tenant claim is refused (42501). It answers one boolean, never a row. The recipients' ids keep the
-- lookup on `notifications_tenant_user_dedupe_uq`.
--
-- Hardening: `set search_path = ''`, fully qualified names, `revoke all … from public`, `grant
-- execute … to authenticated` only (the worker's tenant lane). `app` is not PostgREST-exposed.
--
-- Proved by `supabase/tests/151-notifications.sql` fact 11 and `apps/api/tests/integration/push.test.ts`.

create or replace function app.notifications_withdrawn(p_dedupe_key text, p_user_ids uuid[])
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
begin
  if v_t is null then
    raise exception 'notifications_withdrawn: refused' using errcode = '42501';
  end if;
  return exists (
    select 1
      from public.notifications n
     where n.tenant_id = v_t
       and n.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
       and n.dedupe_key = p_dedupe_key
       and n.payload->>'removed' = 'true'
  );
end
$$;
--> statement-breakpoint
revoke all on function app.notifications_withdrawn(text, uuid[]) from public;--> statement-breakpoint
grant execute on function app.notifications_withdrawn(text, uuid[]) to authenticated;
