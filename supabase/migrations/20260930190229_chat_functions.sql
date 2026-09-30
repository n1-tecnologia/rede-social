-- chat_functions (07-08, CHAT-01..05) — the two row triggers every chat write passes through. Its
-- companion `20260930190151_chat.sql` is the GENERATED half (the counters, the author side, the body
-- CHECK, the inbox index and the participant/staff-aware policies); this file is what drizzle-kit
-- cannot model.
--
-- ── WHY THE COUNTER ROW LOCK IS THE SEQ SOURCE (RESEARCH Pattern 9, Pitfall 10) ─────────────────────
-- `chat_messages_seq_trg` (BEFORE INSERT) increments `chat_conversations.last_seq` and writes the new
-- value into NEW.seq. The UPDATE takes the conversation row's lock and holds it until the writer's
-- transaction ends, so two writers of ONE conversation serialise:
--   * no gaps: a rolled-back insert rolls its counter back with it;
--   * no duplicates: the second writer re-reads the committed counter after the first commits
--     (`chat_messages_conversation_seq_uq` is the backstop);
--   * COMMIT ORDER EQUALS SEQ ORDER: a reader that sees seq 6 has already been able to see seq 5, which
--     is what makes the "messages after seq N" catch-up (D-240) lose nothing.
-- A Postgres sequence or `max(seq) + 1` would give none of the three. Contention is per conversation
-- only (one member plus the team), so it is negligible. Any `seq` a writer supplies is overwritten.
-- Postgres fires BEFORE INSERT row triggers BEFORE the ON CONFLICT arbiter, so an `insert … on
-- conflict do nothing` that conflicts would still consume a seq: no writer may use one on this table
-- (the API never does; the seed checks for an empty thread instead).
-- The same UPDATE maintains `last_message_at`, `last_message_side`, `last_staff_seq` and, for a staff
-- message, the team's shared read position `staff_last_read_seq` (D-225: replying reads the thread for
-- every staff member).
--
-- ── WHY SECURITY DEFINER (both functions) ───────────────────────────────────────────────────────────
-- * BEFORE: a member lane may insert a message but must not be what grants itself the right to move
--   the conversation's counters; the counter update runs as the owner, scoped by the explicit
--   `c.id = new.conversation_id and c.tenant_id = new.tenant_id` predicate. The row's policy WITH CHECK
--   is evaluated AFTER this trigger, so an insert into a conversation the lane cannot see still fails
--   and rolls the counter update back with it.
-- * AFTER (RESEARCH Pitfall 2): the installed `realtime.send` is SECURITY INVOKER and swallows every
--   error as a WARNING. Called from the tenant lane (`authenticated`, RLS on, no insert policy on
--   `realtime.messages`) it would be a SILENT NO-OP. The owner (`postgres`, rolbypassrls) can insert.
-- The owner bypasses RLS, so RLS protects nothing in here: every statement pins the row's own tenant.
--
-- ── WHY IDS ONLY (T-07-53) ──────────────────────────────────────────────────────────────────────────
-- A signal says "something changed in conversation C up to seq S, refetch"; the text always comes back
-- through the API, which applies the policies above. The payload is `{ conversationId, seq }` (the
-- installed `realtime.send` adds its own message-row `id`, still ids only). The message text, the
-- author and any name never travel on a topic, so a mis-scoped join could learn at most that a
-- conversation moved.
--
-- ── TOPICS (07-01's grammar; `app.realtime_topic_allowed` already authorises them) ───────────────────
--   tenant:<t>:conv:<c>       `chat.message` on every insert (participants, staff on support);
--   tenant:<t>:support-inbox  `chat.message` when the conversation is `support` (staff);
--   tenant:<t>:user:<member>  `chat.unread` when the author side is `staff` (the member's dot, D-237).
-- Every writer (the API, the seed, the tests, a psql session) publishes automatically, inside its own
-- transaction: Realtime decodes committed WAL only, so a rolled-back message publishes nothing.
--
-- Hardening: `set search_path = ''`, fully qualified names, `revoke all … from public` (a trigger
-- function is never called directly). `app` is not a PostgREST-exposed schema.
--
-- Proved by `supabase/tests/152-chat.sql` and `apps/api/tests/integration/chat.test.ts`.

create or replace function app.chat_messages_before_insert() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  update public.chat_conversations c
     set last_seq = c.last_seq + 1,
         last_message_at = now(),
         last_message_side = new.author_side,
         last_staff_seq = case when new.author_side = 'staff' then c.last_seq + 1
                               else c.last_staff_seq end,
         staff_last_read_seq = case when new.author_side = 'staff' then c.last_seq + 1
                                    else c.staff_last_read_seq end
   where c.id = new.conversation_id
     and c.tenant_id = new.tenant_id
  returning c.last_seq into new.seq;
  if not found then
    raise exception using errcode = '23503', constraint = 'chat_messages_conversation_visible',
                          message = 'conversation_not_found';
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke all on function app.chat_messages_before_insert() from public;--> statement-breakpoint

create trigger chat_messages_seq_trg
  before insert on public.chat_messages
  for each row execute function app.chat_messages_before_insert();--> statement-breakpoint

create or replace function app.chat_messages_after_insert() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_member uuid;
  v_signal jsonb;
begin
  select c.kind, c.created_by_user_id
    into v_kind, v_member
    from public.chat_conversations c
   where c.id = new.conversation_id
     and c.tenant_id = new.tenant_id;

  v_signal := jsonb_build_object('conversationId', new.conversation_id, 'seq', new.seq);

  perform realtime.send(
    v_signal,
    'chat.message',
    'tenant:' || new.tenant_id::text || ':conv:' || new.conversation_id::text,
    true
  );
  if v_kind = 'support' then
    perform realtime.send(
      v_signal,
      'chat.message',
      'tenant:' || new.tenant_id::text || ':support-inbox',
      true
    );
  end if;
  if new.author_side = 'staff' and v_member is not null then
    perform realtime.send(
      v_signal,
      'chat.unread',
      'tenant:' || new.tenant_id::text || ':user:' || v_member::text,
      true
    );
  end if;
  return null;
end
$$;
--> statement-breakpoint
revoke all on function app.chat_messages_after_insert() from public;--> statement-breakpoint

create trigger chat_messages_signal_trg
  after insert on public.chat_messages
  for each row execute function app.chat_messages_after_insert();
