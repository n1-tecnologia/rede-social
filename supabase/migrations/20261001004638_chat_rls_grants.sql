-- chat_rls_grants (07 review A-CR-01 / A-WR-01 / B-WR-04) — the hand-written half of
-- `20261001004630_chat_rls_per_command.sql`, which split the three `FOR ALL` chat policies per
-- command. A policy decides WHICH ROWS a lane may touch; it cannot say which COLUMNS. Two UPDATE
-- policies remain, and each must move one read position only:
--
-- * `chat_conversations_staff_update` (staff, support threads): the team's shared read position
--   `staff_last_read_seq` (`markConversationRead`) and the `for update of c` lock `replyToConversation`
--   takes (a row lock needs UPDATE on at least one column). Never `last_seq`: rewinding it would make
--   every later insert collide with `chat_messages_conversation_seq_uq` and break the thread for good.
--   The counters move only through `app.chat_messages_before_insert` (a definer, unaffected here).
-- * `chat_participants_update_own` (a member, its own row): `last_read_seq` and `last_read_at`. Never
--   `conversation_id` or `user_id`: moving one's own participant row into another member's thread is
--   the same enrolment A-CR-01 closes on INSERT.
--
-- Chat is append-only for a lane: there is no DELETE policy, and TRUNCATE (which RLS does not see) is
-- revoked too. The system lane (`service_role`) and the migration role keep their privileges.
--
-- Proved by `supabase/tests/152-chat.sql` fact 8.

revoke update, delete, truncate on public.chat_conversations from authenticated;--> statement-breakpoint
grant update (staff_last_read_seq) on public.chat_conversations to authenticated;--> statement-breakpoint
revoke update, delete, truncate on public.chat_participants from authenticated;--> statement-breakpoint
grant update (last_read_seq, last_read_at) on public.chat_participants to authenticated;--> statement-breakpoint
revoke update, delete, truncate on public.chat_messages from authenticated;
