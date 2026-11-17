-- chat_cases_actions (Phase 12.4 plan 03, CASE-05, CASE-08, CASE-12, CASE-18, CASE-23; D-805, D-806, D-810, D-842, D-845;
-- T-12.4-11, T-12.4-12, T-12.4-13, T-12.4-15, T-12.4-16) — the staff half of the case state machine, hand-written
-- (`--custom`): drizzle-kit cannot model functions. THIS file carries `app.chat_case_signal` and the FIRST version of
-- `app.chat_case_act`, with the `take` branch only; `*_chat_cases_actions_matrix.sql` (sorted after this one) REDEFINES
-- `app.chat_case_act` whole with every branch and is the FINAL definition. `*_chat_cases_edit.sql` adds the edit definer.
--
-- ── WHY ONE SECURITY DEFINER PER STAFF ACTION (D-845) ──────────────────────────────────────────────────
-- `chat_conversations` has no UPDATE grant for `authenticated` on the case columns (state, owner, category, priority,
-- resolved_at, closed_at) and `chat_case_events` has no write policy, so a lane can never move a case by itself: every
-- staff action is one of these functions, which write the case row AND its history row in the same block, so a state change
-- without a history row stays impossible (T-12.4-16). The owner is `postgres` (`rolbypassrls`), so RLS protects NOTHING
-- inside a definer and the tenant scope is the function's own: every statement pins `tenant_id = app.tenant_id()` and
-- `kind = 'support'`, the caller is checked against the claims AND against a live membership, and the conversation row is
-- taken `for update` before anything is read, so two actions racing on one case are serialised and the loser sees the
-- winner's state and answers CS002 (T-12.4-13). Conventions of `20261105152916_reports_blocks_functions.sql` carry over:
-- `set search_path = ''`, fully qualified names, `revoke all … from public`, `grant execute … to authenticated` only.
-- `app` is not a PostgREST-exposed schema, so none of this is RPC-reachable.
--
-- THE STAFF LITERAL. `app.tenant_role() in ('admin_tenant', 'support_tenant')` is the same list the chat policies and
-- `app.realtime_topic_allowed` spell, and `apps/api/tests/integration/chat.test.ts` (RESEARCH Pitfall 4) parses it out of
-- this body and compares it with the TypeScript roles, so a later change of the staff roles that misses this function
-- fails a test.
--
-- SQLSTATE. `42501` caller is not live staff (no claims, a member lane, a claim that no live membership backs); `22023`
-- an unknown or padded action, a null conversation or a null / unknown expected state; `CS001` not found, another tenant's
-- or not a support case (one answer for all three, so nothing can tell them apart); `CS002` the case is no longer in the
-- state the caller saw (or, for a take-over, no longer owned by the person the caller saw), nothing changed; `CS003` the
-- action is not allowed from the state the case is in; `CS005` the assignee is not a live staff member of the tenant, or is
-- already the owner. Every code carries a short machine message that plan 08 maps.
--
-- THE SIGNAL (CASE-18). Each action publishes ONE ids-only `chat.case` signal on the conversation topic, on the support
-- inbox and on the member's own topic. The payload is `{ conversationId }` plus the `id` that `realtime.send` injects;
-- no title, subject, name or body ever rides a signal, and an action never writes a message or a notification row.

-- ── app.chat_case_signal ─────────────────────────────────────────────────────────────────────────────
-- The three `chat.case` publishes of one change. An internal helper of the definers: no grant at all (the definers run as
-- the owner, which is what may execute it), so no lane can publish a case signal by itself.
create or replace function app.chat_case_signal(p_tenant uuid, p_conversation uuid, p_member uuid) returns void
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_payload jsonb := jsonb_build_object('conversationId', p_conversation);
begin
  perform realtime.send(v_payload, 'chat.case',
    'tenant:' || p_tenant::text || ':conv:' || p_conversation::text, true);
  perform realtime.send(v_payload, 'chat.case',
    'tenant:' || p_tenant::text || ':support-inbox', true);
  if p_member is not null then
    perform realtime.send(v_payload, 'chat.case',
      'tenant:' || p_tenant::text || ':user:' || p_member::text, true);
  end if;
end
$$;
--> statement-breakpoint
revoke all on function app.chat_case_signal(uuid, uuid, uuid) from public;--> statement-breakpoint

-- ── app.chat_case_act (first version: the take branch only; the matrix file redefines it whole) ────────
create or replace function app.chat_case_act(
  p_conversation uuid,
  p_action text,
  p_expected_state text,
  p_expected_owner uuid,
  p_target uuid
) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_now timestamptz := clock_timestamp();
  v_state text;
  v_owner uuid;
  v_member uuid;
  v_number integer;
  v_to text;
  v_new_owner uuid;
begin
  if v_t is null or v_u is null
     or not coalesce(app.tenant_role() in ('admin_tenant', 'support_tenant'), false) then
    raise exception using errcode = '42501', message = 'case_act_refused';
  end if;
  if not exists (
    select 1
      from public.memberships m
     where m.tenant_id = v_t
       and m.user_id = v_u
       and m.role = app.tenant_role()
       and m.status = 'active'
       and m.blocked_at is null
       and m.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'case_act_refused';
  end if;

  if p_conversation is null
     or p_action is null or p_action not in ('take', 'assign', 'resolve', 'close', 'reopen')
     or p_expected_state is null or p_expected_state not in ('open', 'in_progress', 'resolved', 'closed') then
    raise exception using errcode = '22023', message = 'case_act_invalid';
  end if;

  select c.state, c.owner_user_id, c.created_by_user_id, c.case_number
    into v_state, v_owner, v_member, v_number
    from public.chat_conversations c
   where c.id = p_conversation
     and c.tenant_id = v_t
     and c.kind = 'support'
     for update;
  if not found then
    raise exception using errcode = 'CS001', message = 'case_not_found';
  end if;

  if v_state is distinct from p_expected_state then
    raise exception using errcode = 'CS002', message = 'case_stale';
  end if;

  if p_action = 'take' then
    if v_state = 'open' then
      v_to := 'in_progress';
      v_new_owner := v_u;
    elsif v_state = 'in_progress' then
      if v_owner = v_u then
        raise exception using errcode = 'CS003', message = 'case_transition_not_allowed';
      end if;
      if p_expected_owner is distinct from v_owner then
        raise exception using errcode = 'CS002', message = 'case_stale';
      end if;
      v_to := 'in_progress';
      v_new_owner := v_u;
    else
      raise exception using errcode = 'CS003', message = 'case_transition_not_allowed';
    end if;

    update public.chat_conversations c
       set state = v_to,
           owner_user_id = v_new_owner
     where c.id = p_conversation
       and c.tenant_id = v_t;
    insert into public.chat_case_events
      (tenant_id, conversation_id, kind, actor_user_id, from_state, to_state, created_at)
    values (v_t, p_conversation, 'taken', v_u, v_state, v_to, v_now);
  else
    -- assign, resolve, close and reopen are written in the matrix file; until it applies they are not allowed.
    raise exception using errcode = 'CS003', message = 'case_transition_not_allowed';
  end if;

  perform app.chat_case_signal(v_t, p_conversation, v_member);

  return jsonb_build_object(
    'id', p_conversation,
    'number', v_number,
    'from_state', v_state,
    'state', v_to,
    'owner_user_id', v_new_owner,
    'resolved_at', null
  );
end
$$;
--> statement-breakpoint
revoke all on function app.chat_case_act(uuid, text, text, uuid, uuid) from public;--> statement-breakpoint
grant execute on function app.chat_case_act(uuid, text, text, uuid, uuid) to authenticated;
