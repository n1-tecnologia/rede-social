-- direct_open (Phase 11, CHAT-06; D-719, D-720; T-11-01, T-11-03, T-11-05) — `app.direct_conversation_open`, the ONLY
-- creator of a direct conversation. Hand-written (`--custom`), sorted after `*_direct_pair_gates.sql` (the helpers it
-- calls) and `*_direct_pairs.sql` (the pair columns and the unique index its `on conflict` arbiter names).
--
-- A claims-pinned security definer: the tenant and the caller come from the claims, never from an argument. It
-- refuses with 42501 a lane with no claims or a caller who is not live in the claim's tenant, and with the ONE
-- SQLSTATE `DM001` (one message, no reason) every other refusal: a null target, the caller, a target that is not a live
-- `member` of the same tenant (staff, removed, blocked by the administrator, invited, another tenant), `social` off, or
-- a member block standing either way. A refusal writes nothing and cannot be told apart by cause (T-11-03).
--
-- The pair is ordered by `least` and `greatest` on the UUID type (byte order, never text), so a pair opened from either
-- side lands on the same row. The insert uses `on conflict` on the partial unique index, so twenty concurrent first
-- calls for one pair create exactly one row: the losers wait for the winner's commit, do nothing, and read its id.
-- BOTH users are enrolled as `member` participants (`on conflict do nothing`). It answers `(conversation_id, created)`.
--
-- The tenant lane can no longer insert a `direct` row (`*_direct_policies.sql` narrows the insert policy), so this
-- function is the only door.
create or replace function app.direct_conversation_open(p_other uuid)
returns table (conversation_id uuid, created boolean)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_low uuid;
  v_high uuid;
  v_id uuid;
  v_created boolean := false;
begin
  if v_t is null or v_u is null then
    raise exception 'direct_conversation_open: refused' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.memberships m
     where m.tenant_id = v_t
       and m.user_id = v_u
       and m.status = 'active'
       and m.blocked_at is null
       and m.deleted_at is null
  ) then
    raise exception 'direct_conversation_open: refused' using errcode = '42501';
  end if;

  if p_other is null or p_other = v_u or not app.pair_open_in(v_t, v_u, p_other) then
    raise exception 'direct_conversation_open: not available' using errcode = 'DM001';
  end if;

  v_low := least(v_u, p_other);
  v_high := greatest(v_u, p_other);

  insert into public.chat_conversations (tenant_id, kind, created_by_user_id, direct_low_user_id, direct_high_user_id)
  values (v_t, 'direct', v_u, v_low, v_high)
  on conflict (tenant_id, direct_low_user_id, direct_high_user_id) where direct_low_user_id is not null do nothing
  returning id into v_id;

  if v_id is not null then
    v_created := true;
  else
    select c.id into v_id
      from public.chat_conversations c
     where c.tenant_id = v_t
       and c.direct_low_user_id = v_low
       and c.direct_high_user_id = v_high;
    if v_id is null then
      raise exception 'direct_conversation_open: not available' using errcode = 'DM001';
    end if;
  end if;

  insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
  values (v_id, v_t, v_u, 'member'),
         (v_id, v_t, p_other, 'member')
  on conflict do nothing;

  return query select v_id, v_created;
end
$$;
--> statement-breakpoint
revoke all on function app.direct_conversation_open(uuid) from public, anon;--> statement-breakpoint
grant execute on function app.direct_conversation_open(uuid) to authenticated;
