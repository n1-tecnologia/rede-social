-- chat_cases_edit (Phase 12.4 plan 03, CASE-10, CASE-12, CASE-18, CASE-23; D-810, D-811, D-812, D-845; T-12.4-12,
-- T-12.4-15, T-12.4-16) — the edit definer of the case state machine, hand-written (`--custom`). It repeats the conventions of
-- `*_chat_cases_actions.sql` (security definer, `set search_path = ''`, fully qualified names, claims and live-membership
-- check, tenant and `kind = 'support'` pin in every statement, the conversation row taken `for update`, the expected state
-- as the stale check, `revoke … from public`, `grant execute … to authenticated` only). Read that header for the SQLSTATE
-- codes: this function raises `42501`, `22023`, `CS001`, `CS002` and `CS003` with the same meaning, plus the table CHECK
-- violation `23514` for a value outside the lists or an over-long subject.
--
-- ── WHAT AN EDIT IS (D-811, D-812) ─────────────────────────────────────────────────────────────────────
-- The team changes the category, the subject and the priority of a case that is not closed (open, in_progress or resolved;
-- a closed case is CS003, and an edit that expected another state is CS002). A null argument leaves its field alone, so a
-- caller sends only what it changes; the subject has no way to say "null means clear", so `p_blank_subject = true` is the
-- explicit way to remove it (the route of plan 08 maps `subject: null` to it). A typed subject is 1 to 80 code points, a
-- category and a priority come from the table's lists: all three bounds are the TABLE CHECKs, not a second copy here.
--
-- ── ONE HISTORY ROW PER CHANGED FIELD (D-810) ──────────────────────────────────────────────────────────
-- An `edited` event carries the field name and its own from and to values (staff-only history, so the subject text may
-- appear in it; it never reaches a signal). A field whose new value equals the current one writes nothing, and an edit
-- that changes no field at all writes no event, no update and no signal and answers the case unchanged (EP-035). The rows
-- of one call share the one `clock_timestamp()` taken at the start of the call, so they read together, ordered by id.
--
-- ── THE SIGNAL (CASE-18) ───────────────────────────────────────────────────────────────────────────────
-- One ids-only `chat.case` signal per topic (not one per field) when something changed, through `app.chat_case_signal`.
create or replace function app.chat_case_edit(
  p_conversation uuid,
  p_expected_state text,
  p_category text,
  p_subject text,
  p_blank_subject boolean,
  p_priority text
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
  v_resolved_at timestamptz;
  v_category text;
  v_subject text;
  v_priority text;
  v_new_category text;
  v_new_subject text;
  v_new_priority text;
  v_changed boolean := false;
begin
  if v_t is null or v_u is null
     or not coalesce(app.tenant_role() in ('admin_tenant', 'support_tenant'), false) then
    raise exception using errcode = '42501', message = 'case_edit_refused';
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
    raise exception using errcode = '42501', message = 'case_edit_refused';
  end if;

  if p_conversation is null
     or p_expected_state is null or p_expected_state not in ('open', 'in_progress', 'resolved', 'closed')
     or (coalesce(p_blank_subject, false) and p_subject is not null) then
    raise exception using errcode = '22023', message = 'case_edit_invalid';
  end if;

  select c.state, c.owner_user_id, c.created_by_user_id, c.case_number, c.resolved_at,
         c.category, c.subject, c.priority
    into v_state, v_owner, v_member, v_number, v_resolved_at, v_category, v_subject, v_priority
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
  if v_state = 'closed' then
    raise exception using errcode = 'CS003', message = 'case_transition_not_allowed';
  end if;

  v_new_category := coalesce(p_category, v_category);
  v_new_priority := coalesce(p_priority, v_priority);
  v_new_subject := case when coalesce(p_blank_subject, false) then null else coalesce(p_subject, v_subject) end;

  if v_new_category is distinct from v_category
     or v_new_priority is distinct from v_priority
     or v_new_subject is distinct from v_subject then
    v_changed := true;

    -- The table CHECKs refuse a value outside the lists and a subject outside 1..80 code points (23514).
    update public.chat_conversations c
       set category = v_new_category,
           priority = v_new_priority,
           subject = v_new_subject
     where c.id = p_conversation
       and c.tenant_id = v_t;

    if v_new_category is distinct from v_category then
      insert into public.chat_case_events
        (tenant_id, conversation_id, kind, actor_user_id, field, from_value, to_value, created_at)
      values (v_t, p_conversation, 'edited', v_u, 'category', v_category, v_new_category, v_now);
    end if;
    if v_new_priority is distinct from v_priority then
      insert into public.chat_case_events
        (tenant_id, conversation_id, kind, actor_user_id, field, from_value, to_value, created_at)
      values (v_t, p_conversation, 'edited', v_u, 'priority', v_priority, v_new_priority, v_now);
    end if;
    if v_new_subject is distinct from v_subject then
      insert into public.chat_case_events
        (tenant_id, conversation_id, kind, actor_user_id, field, from_value, to_value, created_at)
      values (v_t, p_conversation, 'edited', v_u, 'subject', v_subject, v_new_subject, v_now);
    end if;
  end if;

  if v_changed then
    perform app.chat_case_signal(v_t, p_conversation, v_member);
  end if;

  return jsonb_build_object(
    'id', p_conversation,
    'number', v_number,
    'from_state', v_state,
    'state', v_state,
    'owner_user_id', v_owner,
    'resolved_at', v_resolved_at
  );
end
$$;
--> statement-breakpoint
revoke all on function app.chat_case_edit(uuid, text, text, text, boolean, text) from public;--> statement-breakpoint
grant execute on function app.chat_case_edit(uuid, text, text, text, boolean, text) to authenticated;
