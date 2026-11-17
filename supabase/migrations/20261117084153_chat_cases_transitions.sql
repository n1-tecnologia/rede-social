-- chat_cases_transitions (Phase 12.4 plan 02, CASE-03, CASE-05, CASE-06, CASE-07, CASE-21; D-805, D-806, D-814, D-845;
-- T-12.4-06, T-12.4-07, T-12.4-09, T-12.4-10) — the two functions the activation file needs, hand-written (`--custom`):
-- the REPLACED message trigger function and the legacy backfill. This file sorts BEFORE `*_chat_cases_activate.sql`
-- on purpose: the activation calls `app.chat_cases_backfill()` and would fail if the function did not exist yet. The
-- message trigger already works on a legacy row (a null state is "counters only"), so applying this file alone, between
-- the two, breaks nothing.
--
-- ── app.chat_messages_before_insert (REPLACED, same name, signature and trigger binding) ───────────────────────────
-- The shipped function is ONE `update … returning` that bumps the counters under the conversation row lock and raises
-- `23503 conversation_not_found` when nothing matched (`20260930190229_chat_functions.sql`; its header explains why the
-- counter row lock is the seq source and why it is a definer). It keeps all of that VERBATIM and gains, under the same
-- lock, every MESSAGE-DRIVEN move of the case (D-805, D-806, D-845). The staff actions (take, assign, resolve, close,
-- reopen, edit) are plan 05's; the sweep is plan 04's. What a message does to a case:
--
--   | state of the case | author | result                                                                         |
--   | closed            | anyone | refused, SQLSTATE CS004 'case_closed', nothing written, no seq consumed          |
--   | resolved          | member | open, no owner, resolved_at cleared, a `reopened` event carrying the message id  |
--   | open (unowned)    | staff  | in_progress, owned by the author, a `taken` event carrying the message id        |
--   | any other         | any    | counters only                                                                    |
--   | null (legacy)     | any    | counters only (the row between the functions file and the activation file)       |
--
-- Why CS004 is raised under `for update`: a message arriving while a staff close or the sweeper holds the row waits for
-- it, then sees `closed` and is refused for EVERY writer (the API, the worker, the seed, a psql session). The API
-- retries once through its open path, in a NEW transaction (a raised exception aborts the old one), so the message
-- lands in a NEW case and never in the closed one (D-801). Everything in this function sets the columns the coherence
-- CHECK reads together (an `open` case has no owner and no `resolved_at`; an `in_progress` one has an owner), so the
-- row is never momentarily incoherent. The events are written BEFORE the message row exists (`chat_case_events.message_id`
-- has no foreign key for exactly this); a failing message insert rolls them back with the statement.
-- A `direct` or `group` row has a null state and falls in "counters only" (CASE-25).
create or replace function app.chat_messages_before_insert() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_state text;
  v_owner uuid;
  v_next text;
begin
  select c.state, c.owner_user_id
    into v_state, v_owner
    from public.chat_conversations c
   where c.id = new.conversation_id
     and c.tenant_id = new.tenant_id
     for update;
  if not found then
    raise exception using errcode = '23503', constraint = 'chat_messages_conversation_visible',
                          message = 'conversation_not_found';
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
--> statement-breakpoint

-- ── app.chat_cases_backfill (D-814, CASE-21) ───────────────────────────────────────────────────────────────────────
-- Turns every support conversation that has no state (a conversation that predates plan 01) into a numbered case,
-- keeping its id and every message. Per tenant that has at least one such row (a tenant with none, or with only direct
-- and group rows, gets nothing and no counter row, EP-068):
--   * the counter row is locked first, so a case opening at the same time cannot take a number out from under it;
--   * the rows are numbered by (first message instant, or the conversation's own creation when it has no message;
--     then id), continuing after the larger of the counter and the highest number the tenant already holds;
--   * `open` when the last message is the member's and `last_seq > staff_last_read_seq` (a comparison of SEQUENCES,
--     never of instants, so no clock rounding decides, EP-071), `closed` otherwise, with `closed_at` the last message
--     instant (or the creation when there is none, EP-066); category other, priority normal, no stored subject;
--   * one `opened` event per case (actor the member, at the first message instant) and, for a closed one, a `closed`
--     event with no actor (a migrated closed case must stay closed and must never notify anybody: this function writes
--     states and history ONLY, it has no notification path);
--   * the counter is left at the maximum.
-- Idempotent: only rows whose state is null are touched, so a second run assigns nothing and moves nothing. Messages,
-- participant rows, ids and the e2e seed id `1d000000-0000-4000-8000-000000000001` are never written. Ordering uses the
-- timestamptz value and the uuid byte order, never text (EP-069).
create or replace function app.chat_cases_backfill(p_tenant uuid default null) returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_base integer;
  v_done integer;
  v_total integer := 0;
begin
  for v_tenant in
    select distinct c.tenant_id
      from public.chat_conversations c
     where c.kind = 'support'
       and c.state is null
       and (p_tenant is null or c.tenant_id = p_tenant)
     order by 1
  loop
    insert into public.chat_case_counters (tenant_id, last_number)
    values (v_tenant, 0)
    on conflict (tenant_id) do update
      set last_number = public.chat_case_counters.last_number
    returning last_number into v_base;

    select greatest(v_base, coalesce(max(c.case_number), 0))
      into v_base
      from public.chat_conversations c
     where c.tenant_id = v_tenant
       and c.kind = 'support';

    with legacy as (
      select c.id,
             c.created_by_user_id,
             c.created_at,
             coalesce(
               (select min(m.created_at)
                  from public.chat_messages m
                 where m.conversation_id = c.id
                   and m.tenant_id = c.tenant_id),
               c.created_at) as first_at,
             (c.last_message_side = 'member' and c.last_seq > c.staff_last_read_seq) as awaiting,
             coalesce(c.last_message_at, c.created_at) as last_at
        from public.chat_conversations c
       where c.tenant_id = v_tenant
         and c.kind = 'support'
         and c.state is null
    ),
    numbered as (
      select l.*,
             v_base + row_number() over (order by l.first_at, l.id) as n
        from legacy l
    ),
    upd as (
      update public.chat_conversations c
         set case_number = n.n,
             state = case when n.awaiting then 'open' else 'closed' end,
             category = 'other',
             priority = 'normal',
             closed_at = case when n.awaiting then null else n.last_at end
        from numbered n
       where c.id = n.id
         and c.tenant_id = v_tenant
         and c.state is null
      returning c.id, c.state, n.created_by_user_id, n.first_at, n.last_at
    ),
    opened as (
      insert into public.chat_case_events
        (tenant_id, conversation_id, kind, actor_user_id, to_state, created_at)
      select v_tenant, u.id, 'opened', u.created_by_user_id, 'open', u.first_at
        from upd u
       where not exists (
         select 1 from public.chat_case_events e
          where e.conversation_id = u.id and e.kind = 'opened')
      returning 1
    ),
    closed as (
      insert into public.chat_case_events
        (tenant_id, conversation_id, kind, actor_user_id, from_state, to_state, created_at)
      select v_tenant, u.id, 'closed', null, 'open', 'closed',
             greatest(u.last_at, u.first_at + interval '1 microsecond')
        from upd u
       where u.state = 'closed'
      returning 1
    )
    select count(*) into v_done from upd;

    update public.chat_case_counters k
       set last_number = v_base + v_done
     where k.tenant_id = v_tenant;
    v_total := v_total + v_done;
  end loop;
  return v_total;
end
$$;
--> statement-breakpoint
comment on function app.chat_cases_backfill(uuid) is
  'D-814: numbers every support conversation that has no state. Ordering uses the timestamptz value of the first message (or of the conversation creation) and then the uuid byte order, never text (EP-069); open vs closed compares sequences, never instants (EP-071). service_role only, idempotent, writes states and history only.';
--> statement-breakpoint
revoke all on function app.chat_cases_backfill(uuid) from public, anon, authenticated;--> statement-breakpoint
grant execute on function app.chat_cases_backfill(uuid) to service_role;
