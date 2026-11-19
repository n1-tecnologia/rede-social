-- chat_support_conversation_gate (Phase 11 plan 09, D-731, D-482; T-11-09) — `app.chat_conversation_is_support`, the one predicate
-- `chat_participants_select` needs to stop showing staff the participant rows of a direct conversation. Hand-written
-- (`--custom`); sorted BEFORE `*_direct_participants_policy.sql`, the generated policy edit that calls it.
--
-- WHY. Until now `chat_participants_select` let staff read EVERY participant row of the tenant ("any row of your tenant when you
-- are staff", written when only support conversations existed). From Phase 11 a paired direct holds two member participant rows,
-- so staff could learn WHICH TWO MEMBERS talk to each other and the conversation id, without reading a single message. That
-- is exactly what a message report must not expose (D-731: "no conversation id, no counterpart"): the reported message is
-- the only thing the administrator may see. The staff term of the participant policy must follow the staff term of
-- `chat_conversations_select`, which is `kind = 'support'`.
--
-- WHY A DEFINER. The policy cannot read `chat_conversations` as the invoker: `chat_conversations_select` already reads
-- `chat_participants` (the participant term), so a participant policy that read the conversations back would recurse
-- ("infinite recursion detected in policy"). This function reads the one fact the staff term needs, whether the conversation
-- is a SUPPORT thread of the caller's own tenant, as the owner, and answers a boolean about the caller's tenant only
-- (`app.tenant_id()` from the claims, never an argument), so it cannot be used to probe another tenant. The policy calls it
-- DIRECTLY, never wrapped as `(select app.chat_conversation_is_support(...))`: the sub-select form makes the rewriter see a
-- sublink under the participants policy and raises 42P17 on every insert that reaches `chat_conversations` (probed on 2026-11-19).
--
-- Hardening (the T-06-29 posture): `search_path = ''`, fully qualified names; EXECUTE revoked from PUBLIC and granted to
-- `authenticated` only (a policy expression runs as the caller). Expand-only: a new function, no table, column or row changes.

create or replace function app.chat_conversation_is_support(p_conversation uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.chat_conversations c
     where c.id = p_conversation
       and c.tenant_id = app.tenant_id()
       and c.kind = 'support'
  )
$$;
--> statement-breakpoint
revoke all on function app.chat_conversation_is_support(uuid) from public;--> statement-breakpoint
grant execute on function app.chat_conversation_is_support(uuid) to authenticated;
