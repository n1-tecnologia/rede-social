-- chat_cases_assign_expected_owner (Phase 12.4 plan 22, gap closure WR-04; CASE-08, CASE-09; D-806, D-842, D-845;
-- T-12.4-97, T-12.4-98, T-12.4-99, T-12.4-100, T-12.4-101) — the FINAL definition of `app.chat_case_act`. Hand-written
-- (`--custom`). The earlier file `*_chat_cases_actions_matrix.sql` is already recorded in the migration history, so the
-- function is redefined whole here with `create or replace` (same name, signature and grants); this file is the one to read.
--
-- WHY. The assign branch accepted `p_expected_owner` and never looked at it (only `take` did), so a second admin's concurrent
-- assignment of an in-progress case silently overwrote the first one (a lost update). Now, in the assign branch, AFTER the
-- transition check and BEFORE the assignee check, an in-progress case whose owner is not the expected one raises CS002
-- (`case_stale`, the route answers 409 `case_stale`): nothing is updated, no history row is written, no signal is published
-- and the answer names no owner. The order is deliberate: the assignee rules ('not already the owner') only mean something
-- against the owner the caller saw, so a stale caller hears 'the case moved', not 'invalid target'.
--
-- SQLSTATE (unchanged list): 42501 refused role or lane, 22023 invalid arguments, CS001 case not found, CS002 stale (state OR
-- owner), CS003 transition not allowed, CS005 assignee invalid.
--
-- TRANSITION TABLE, assign row (the other rows are as in `*_chat_cases_actions_matrix.sql`):
--   | assign  | open                         | in_progress, owner = the target; a stray expected owner is ignored    | admin   |
--   | assign  | in_progress                  | in_progress, owner = the target, ONLY when the expected owner equals  | only    |
--   |         |                              | the current owner (CS002 otherwise); the target is a LIVE staff       |         |
--   |         |                              | member who is not the current owner (CS005)                           |         |
--
-- UNCHANGED, copied from the matrix file: `security definer`, `set search_path = ''`, the claim role AND a live membership
-- with that same role, `tenant_id` pinned from the claim, `kind = 'support'`, the row read `for update`, the single
-- `admin_tenant` assign literal and the list of staff roles. Only the assign branch gained the owner refusal.
--
-- RELEASE. Expand-only: one `create or replace` of one function, no table, column or index. It opens no failing window: no web
-- earlier than this phase has an assign control, and this phase's AssignSheet sends the owner it opened on. The way back is
-- another `create or replace`.
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
    -- WR-04 (T-12.4-97): an in-progress case is moved only by a caller who saw its current owner. The comparison runs under
    -- the row lock taken above and BEFORE the assignee check: a stale caller is told the case moved (CS002, nothing written,
    -- no owner named), not that its target is invalid. An open case has no owner, so a stray expected owner is ignored there,
    -- exactly as in the take branch.
    if v_state = 'in_progress' and p_expected_owner is distinct from v_owner then
      raise exception using errcode = 'CS002', message = 'case_stale';
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
