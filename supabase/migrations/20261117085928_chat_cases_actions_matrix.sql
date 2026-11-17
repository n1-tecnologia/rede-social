-- chat_cases_actions_matrix (Phase 12.4 plan 03, CASE-05, CASE-08, CASE-09, CASE-12, CASE-18; D-805, D-806, D-810, D-842,
-- D-845; T-12.4-11, T-12.4-12, T-12.4-13, T-12.4-14, T-12.4-16) — the FINAL definition of `app.chat_case_act`. Hand-written
-- (`--custom`). The earlier file `*_chat_cases_actions.sql` is already recorded in the local migration history with the
-- `take` branch only, so the function is redefined whole here with `create or replace` (same name, signature and grants);
-- this file is the one to read. Its header explains the definer, the lock, the SQLSTATE codes and the signal; this one adds
-- the transition table.
--
-- ── THE TRANSITION TABLE (D-805, D-806, D-842) ─────────────────────────────────────────────────────────
--   | action  | allowed from                 | result                                                              | who     |
--   | take    | open                         | in_progress, owner = the actor                                       | staff   |
--   | take    | in_progress, owned by ANOTHER | in_progress, owner = the actor (a take-over)                         | staff   |
--   | assign  | open, in_progress            | in_progress, owner = the target, a LIVE staff member who is not the  | admin   |
--   |         |                              | current owner (CS005 otherwise)                                      | only    |
--   | resolve | open, in_progress            | resolved, resolved_at set, owner kept                                | staff   |
--   | close   | open, in_progress, resolved  | closed, closed_at set, resolved_at CLEARED, owner kept               | staff   |
--   | reopen  | resolved                     | open, owner cleared, resolved_at cleared                             | staff   |
-- Every other pair is CS003. Resolve and close also set `staff_last_read_seq = last_seq`: the team has answered or
-- dismissed everything written so far, so a closed case never counts as awaiting (EP-026: with no message both are 0).
-- No owner check exists in resolve, close or reopen (D-842): any staff member may resolve or close any case. A take-over
-- needs the expected owner (`p_expected_owner`): without it, or with another person, the answer is CS002 and the row is
-- untouched, so a take-over can only ever replace the owner the caller actually saw. Taking a case the actor already owns
-- is CS003 (EP-037), and so is the same resolve twice.
--
-- ── ONE UPDATE, ONE EVENT (T-12.4-16, CASE-04) ───────────────────────────────────────────────────────────
-- The case row is moved by ONE update that sets every column the coherence CHECK reads (state, owner, resolved_at,
-- closed_at) together, so the row is never momentarily incoherent, and the history row is inserted right after in the same
-- block. The history instant and the case instants are one `clock_timestamp()` taken at the start of the call, so the
-- events of two actions in one transaction still read in order by (created_at, id) (EP-027, EP-036).
--
-- The assignment guard is the single place the role `admin_tenant` is spelled as a sole holder; the list of staff roles is
-- spelled once, in the first check. `apps/api/tests/integration/chat.test.ts` parses both out of this body.
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
  v_resolved_at timestamptz;
  v_closed_at timestamptz;
  v_kind text;
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

  -- Only the holder of the assignment permission assigns (T-12.4-11); the route of plan 08 checks the same permission.
  if p_action = 'assign' and not coalesce(app.tenant_role() = 'admin_tenant', false) then
    raise exception using errcode = '42501', message = 'case_act_refused';
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
    v_kind := 'taken';
    if v_state = 'open' then
      null;
    elsif v_state = 'in_progress' then
      if v_owner = v_u then
        raise exception using errcode = 'CS003', message = 'case_transition_not_allowed';
      end if;
      if p_expected_owner is distinct from v_owner then
        raise exception using errcode = 'CS002', message = 'case_stale';
      end if;
    else
      raise exception using errcode = 'CS003', message = 'case_transition_not_allowed';
    end if;
    v_to := 'in_progress';
    v_new_owner := v_u;

  elsif p_action = 'assign' then
    v_kind := 'assigned';
    if v_state not in ('open', 'in_progress') then
      raise exception using errcode = 'CS003', message = 'case_transition_not_allowed';
    end if;
    -- The target is a LIVE staff member of THIS tenant (T-12.4-14) who is not already the owner.
    if p_target is null
       or p_target is not distinct from v_owner
       or not exists (
         select 1
           from public.memberships m
          where m.tenant_id = v_t
            and m.user_id = p_target
            and m.role in ('admin_tenant', 'support_tenant')
            and m.status = 'active'
            and m.blocked_at is null
            and m.deleted_at is null
       ) then
      raise exception using errcode = 'CS005', message = 'case_assignee_invalid';
    end if;
    v_to := 'in_progress';
    v_new_owner := p_target;

  elsif p_action = 'resolve' then
    v_kind := 'resolved';
    if v_state not in ('open', 'in_progress') then
      raise exception using errcode = 'CS003', message = 'case_transition_not_allowed';
    end if;
    v_to := 'resolved';
    v_new_owner := v_owner;
    v_resolved_at := v_now;

  elsif p_action = 'close' then
    v_kind := 'closed';
    if v_state not in ('open', 'in_progress', 'resolved') then
      raise exception using errcode = 'CS003', message = 'case_transition_not_allowed';
    end if;
    v_to := 'closed';
    v_new_owner := v_owner;
    v_closed_at := v_now;

  else
    v_kind := 'reopened';
    if v_state <> 'resolved' then
      raise exception using errcode = 'CS003', message = 'case_transition_not_allowed';
    end if;
    v_to := 'open';
    v_new_owner := null;
  end if;

  update public.chat_conversations c
     set state = v_to,
         owner_user_id = v_new_owner,
         resolved_at = v_resolved_at,
         closed_at = v_closed_at,
         staff_last_read_seq = case when p_action in ('resolve', 'close') then c.last_seq
                                    else c.staff_last_read_seq end
   where c.id = p_conversation
     and c.tenant_id = v_t;

  insert into public.chat_case_events
    (tenant_id, conversation_id, kind, actor_user_id, target_user_id, from_state, to_state, created_at)
  values (v_t, p_conversation, v_kind, v_u,
          case when p_action = 'assign' then p_target else null end, v_state, v_to, v_now);

  perform app.chat_case_signal(v_t, p_conversation, v_member);

  return jsonb_build_object(
    'id', p_conversation,
    'number', v_number,
    'from_state', v_state,
    'state', v_to,
    'owner_user_id', v_new_owner,
    'resolved_at', v_resolved_at
  );
end
$$;
--> statement-breakpoint
revoke all on function app.chat_case_act(uuid, text, text, uuid, uuid) from public;--> statement-breakpoint
grant execute on function app.chat_case_act(uuid, text, text, uuid, uuid) to authenticated;
