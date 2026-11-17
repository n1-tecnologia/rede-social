-- chat_voice_orphans_sweep (Phase 12.5 plan 08, VOICE-27, VOICE-34; D-856, D-869, D-844; T-12.5-31..33) — the unsent
-- recording that nobody sent is collected after a day, hand-written (`--custom`): drizzle-kit cannot model functions. It
-- rides the kernel's EXISTING hourly sweeper (`kernel.media-sweep-orphans`), which executes every name a module manifest
-- declares in `sweepFunctions` as `select app.<name>(<batch>)` through the admin lane (`withAdminTx`, `set local role
-- service_role`). The chat manifest now declares `sweepFunctions: ['chat_cases_auto_close', 'chat_voice_orphans_sweep']`:
-- ONE function name added to a list, no new queue and no new job name (D-844, amended by D-869).
--
-- WHAT IT COLLECTS. A `voice` asset that is `ready` or `failed`, not yet deleted, created more than 24 hours ago, and that
-- NO `chat_messages` row references: a take the member recorded and never sent (or one the derivation failed on). It is
-- SOFT-deleted (`status = 'deleted'`, `deleted_at = now()`), exactly the state the kernel's own collector purges one hour
-- later (the Storage objects, then the row), so the bytes leave the tenant ceiling and the member's share at once and the
-- objects a little later. Without this function an unsent `ready` take would sit in the quota forever: the kernel sweeper
-- collects `pending` takes after 24 hours and `rejected`/`deleted` ones after an hour, and nothing else.
--
-- WHAT IT NEVER TOUCHES (D-856). A recording a message references lives as long as its conversation, however old it gets:
-- the `not exists` below is the guard, and the NO ACTION foreign key of `chat_messages.media_asset_id` is the second one. A
-- `pending` or `processing` take belongs to the upload and derive pipeline, an image or a video is not a recording, and a
-- row already deleted keeps its own `deleted_at`.
--
-- THE CONTRACT. Soft-delete AT MOST `p_batch` assets (clamped to 1..5000), the OLDEST first with the id as tiebreak, and
-- return how many were soft-deleted. The kernel repeats the call while a full batch comes back, at most 20 times per run, so
-- a backlog drains over a few hours. The cadence is hourly, so a take is collected between 24 and 25 hours after it was made.
--
-- THE 24 HOURS. They are the ONE `interval '24 hours'` literal below (a platform rule, never a tenant setting, never a second
-- copy in TypeScript); `apps/api/tests/integration/chat-voice-sweep.test.ts` and `supabase/tests/236-chat-voice.sql` read it
-- back out of `pg_get_functiondef` and pin it.
--
-- WHY `security definer`. The admin lane runs the function as `service_role`, and the tenant policies of `media_assets`
-- would hide every other tenant's rows from a lane that is not the owner. The consequence is that RLS protects nothing inside
-- the body, so the tenant scope is spelled out: the function is CROSS-TENANT by design (one sweep per project covers every
-- tenant, the T-07-26 posture of `notifications_prune` and of `chat_cases_auto_close`), and each UPDATE pins the row's OWN
-- `tenant_id` (T-12.5-33). Executable by `service_role` ONLY: `authenticated`, `anon` and `public` get no grant (T-12.5-31).
--
-- THE RACE. The row is locked `for update skip locked`. A message being inserted for the same take holds a key-share lock on
-- the asset row through its foreign key, so the sweep skips that row and looks again the next hour; a take the sweep deleted
-- first can no longer be sent (the chat insert policy asks for a live, `ready` asset). Idempotent and silent: the predicate
-- is the state, a second run finds nothing, and the function writes no notification and no event.

create or replace function app.chat_voice_orphans_sweep(p_batch int)
returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n int := 0;
  r record;
begin
  for r in
    select a.id, a.tenant_id
      from public.media_assets a
     where a.purpose = 'voice'
       and a.status in ('ready', 'failed')
       and a.deleted_at is null
       and a.created_at < now() - interval '24 hours'
       and not exists (
         select 1 from public.chat_messages m
          where m.tenant_id = a.tenant_id and m.media_asset_id = a.id
       )
     order by a.created_at, a.id
     limit greatest(1, least(coalesce(p_batch, 1), 5000))
       for update of a skip locked
  loop
    -- The state is restated and the row's own tenant pinned: the row was locked above, so nothing can have moved it, and a
    -- write can never leave its tenant.
    update public.media_assets
       set status = 'deleted', deleted_at = now()
     where id = r.id and tenant_id = r.tenant_id
       and purpose = 'voice' and status in ('ready', 'failed') and deleted_at is null;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;
--> statement-breakpoint
revoke all on function app.chat_voice_orphans_sweep(int) from public, authenticated;--> statement-breakpoint
grant execute on function app.chat_voice_orphans_sweep(int) to service_role;
