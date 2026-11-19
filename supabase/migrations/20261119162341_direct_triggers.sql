-- direct_triggers (Phase 11 plan 06, CHAT-06, CHAT-07; D-719, D-721, D-722, D-728; T-11-03, T-11-04) — the two chat row
-- triggers, REPLACED (`create or replace`, same names, signatures and trigger bindings) so a PAIRED direct conversation
-- gets its send guard, its per-participant unread position and its live signal. Hand-written (`--custom`); expand-only:
-- two function bodies, no table, column, constraint or index change.
--
-- ── app.chat_messages_before_insert (REPLACED) ─────────────────────────────────────────────────────────────────────
-- Starts from the NEWEST body (the 12.4 one, `20261117084153_chat_cases_transitions.sql`, no later file replaces it),
-- copied statement for statement: the conversation row lock, the `23503` not-found refusal, the closed-case refusal
-- CS004, the case transition, the counter update, the two case events. Everything this plan adds is for a PAIRED direct
-- (`direct_low_user_id is not null`); a support case, a bare direct and a group row take the shipped path untouched.
--
--   1. The select that takes the lock also reads the two pair columns, so the guard runs UNDER `for update` on the
--      conversation row. A block definer (plan 07) takes the same lock first, so a send and a block serialise: the send
--      that wins the lock commits, the next send sees the block (CHAT-07, T-11-04).
--   2. Right after the not-found refusal and BEFORE any counter write, a paired row raises SQLSTATE `DM001` (message
--      `direct_closed`) when the pair is not open in the ROW's tenant (`app.pair_open_in`: `social` off, either user not a
--      live member, a block either way) or when the author side is `staff` (staff never take part in a direct, D-482).
--      One code and one message for EVERY cause: the sender is never told why (D-722, T-11-03). A raised exception rolls
--      the statement back, so a refused send consumes no seq and leaves `last_seq` as it was.
--   3. After the counter update that returns the new seq, a paired row moves the AUTHOR's `chat_participants` position to
--      that seq (D-728): a writer has seen everything up to its own message. The unread flag of a participant is then
--      exactly `c.last_seq > p.last_read_seq`, and the recipient's position never moves by someone else's send.
--
-- The function stays a definer with `set search_path = ''` and fully qualified names; the owner bypasses RLS, so every
-- statement pins the row's own tenant. The shipped `revoke all` and the `chat_messages_seq_trg` binding are untouched.
create or replace function app.chat_messages_before_insert() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_state text;
  v_owner uuid;
  v_low uuid;
  v_high uuid;
  v_next text;
begin
  select c.state, c.owner_user_id, c.direct_low_user_id, c.direct_high_user_id
    into v_state, v_owner, v_low, v_high
    from public.chat_conversations c
   where c.id = new.conversation_id
     and c.tenant_id = new.tenant_id
     for update;
  if not found then
    raise exception using errcode = '23503', constraint = 'chat_messages_conversation_visible',
                          message = 'conversation_not_found';
  end if;

  -- D-721, D-722: a paired direct accepts a message only while its pair is open, and only from a participant side.
  if v_low is not null
     and (new.author_side = 'staff' or not app.pair_open_in(new.tenant_id, v_low, v_high)) then
    raise exception using errcode = 'DM001', message = 'direct_closed';
  end if;

  if v_state = 'closed' then
    raise exception using errcode = 'CS004', message = 'case_closed';
  end if;

  -- The move this message causes (null when it causes none).
  v_next := case
              when v_state = 'resolved' and new.author_side = 'member' then 'open'
              when v_state = 'open' and new.author_side = 'staff' then 'in_progress'
              else null
            end;

  update public.chat_conversations c
     set last_seq = c.last_seq + 1,
         last_message_at = now(),
         last_message_side = new.author_side,
         last_staff_seq = case when new.author_side = 'staff' then c.last_seq + 1
                               else c.last_staff_seq end,
         staff_last_read_seq = case when new.author_side = 'staff' then c.last_seq + 1
                                    else c.staff_last_read_seq end,
         state = coalesce(v_next, c.state),
         owner_user_id = case when v_next = 'open' then null
                              when v_next = 'in_progress' then new.author_user_id
                              else c.owner_user_id end,
         resolved_at = case when v_next = 'open' then null else c.resolved_at end
   where c.id = new.conversation_id
     and c.tenant_id = new.tenant_id
  returning c.last_seq into new.seq;

  -- D-728: the author of a paired direct has seen everything up to its own message.
  if v_low is not null then
    update public.chat_participants p
       set last_read_seq = new.seq,
           last_read_at = now()
     where p.conversation_id = new.conversation_id
       and p.tenant_id = new.tenant_id
       and p.user_id = new.author_user_id;
  end if;

  if v_next = 'open' then
    insert into public.chat_case_events
      (tenant_id, conversation_id, kind, actor_user_id, from_state, to_state, message_id)
    values (new.tenant_id, new.conversation_id, 'reopened', new.author_user_id, 'resolved', 'open', new.id);
  elsif v_next = 'in_progress' then
    insert into public.chat_case_events
      (tenant_id, conversation_id, kind, actor_user_id, from_state, to_state, message_id)
    values (new.tenant_id, new.conversation_id, 'taken', new.author_user_id, 'open', 'in_progress', new.id);
  end if;
  return new;
end
$$;
