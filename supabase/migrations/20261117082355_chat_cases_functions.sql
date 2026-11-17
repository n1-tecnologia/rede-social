-- chat_cases_functions (Phase 12.4 plan 01, CASE-01, CASE-02, CASE-12; D-836, D-837, D-804, D-810; T-12.4-04,
-- T-12.4-05) — the two row triggers that make a new support conversation a born-open, numbered case. Hand-written
-- (`--custom`): drizzle-kit cannot model functions. Its companion `*_chat_cases.sql` is the GENERATED half (the seven
-- case columns, `chat_case_counters` and `chat_case_events`); this file is sorted AFTER it, and the CHECKs, the unique
-- number, the indexes and the policies come after this one in `*_chat_cases_constraints.sql`.
--
-- ── WHY TWO TRIGGERS, AND WHY THE NUMBER IS TAKEN AFTER THE INSERT (D-837) ────────────────────────────
-- * `chat_conversations_defaults_trg` (BEFORE INSERT) fills `state = open`, `priority = normal` and `category =
--   other` on a `support` row that left them null, so every writer that only knows the old three columns (the
--   shipped API, the seed, `chat-admin.ts`, the earlier tests, a psql session) keeps working and gets a born-open
--   case. It does not touch any other kind (CASE-25) and never overrides a value the writer set.
-- * `chat_conversations_number_trg` (AFTER INSERT) takes the number from the tenant's counter row. It is AFTER on
--   purpose: Postgres fires a BEFORE ROW trigger even for a row that `on conflict do nothing` then skips (probed on
--   the local PG 17), so a BEFORE design would burn a number on every retry of the member's first message. An AFTER
--   ROW trigger fires only for a row that survived. The counter upsert holds the counter row's lock to the end of
--   the writer's transaction, so two members of one tenant opening together serialise on it and get distinct,
--   consecutive numbers, and a rolled-back insert rolls its bump back (no gap).
--
-- ── WHY SECURITY DEFINER ───────────────────────────────────────────────────────────────────────────────
-- A member lane inserts the conversation but has no privilege on `chat_case_counters` (RLS on, NO policy) or
-- `chat_case_events` (no write policy), and must not be what moves the number: the after-insert function runs as the
-- owner (`postgres`, `rolbypassrls`), so RLS protects NOTHING inside it and every statement pins the row's own
-- tenant. The conventions of `20260930190229_chat_functions.sql` carry over: `set search_path = ''`, fully qualified
-- names, `revoke all … from public`, and NO grant to `authenticated` (a trigger function is never called directly).
-- `app` is not a PostgREST-exposed schema.
--
-- Only a `support` row is ever touched: a `direct` or `group` row gets no default, no number, no counter move and no
-- event (CASE-25).

-- ── app.chat_conversations_before_insert ──────────────────────────────────────────────────────────────
create or replace function app.chat_conversations_before_insert() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'support' then
    new.state := coalesce(new.state, 'open');
    new.priority := coalesce(new.priority, 'normal');
    new.category := coalesce(new.category, 'other');
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke all on function app.chat_conversations_before_insert() from public;--> statement-breakpoint

create trigger chat_conversations_defaults_trg
  before insert on public.chat_conversations
  for each row execute function app.chat_conversations_before_insert();--> statement-breakpoint

-- ── app.chat_conversations_after_insert ───────────────────────────────────────────────────────────────
create or replace function app.chat_conversations_after_insert() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_number integer;
begin
  if new.kind <> 'support' then
    return null;
  end if;

  insert into public.chat_case_counters (tenant_id, last_number)
  values (new.tenant_id, 1)
  on conflict (tenant_id) do update
    set last_number = public.chat_case_counters.last_number + 1
  returning last_number into v_number;

  update public.chat_conversations c
     set case_number = v_number
   where c.id = new.id
     and c.tenant_id = new.tenant_id;

  insert into public.chat_case_events (tenant_id, conversation_id, kind, actor_user_id, to_state)
  values (new.tenant_id, new.id, 'opened', new.created_by_user_id, new.state);

  return null;
end
$$;
--> statement-breakpoint
revoke all on function app.chat_conversations_after_insert() from public;--> statement-breakpoint

create trigger chat_conversations_number_trg
  after insert on public.chat_conversations
  for each row execute function app.chat_conversations_after_insert();
