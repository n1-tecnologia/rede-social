-- block_effects (Phase 11 plan 07, CHAT-07; D-722, D-723, D-724, D-725, D-616; T-11-01, T-11-03, T-11-04, T-11-21) — what a
-- member block now does in the database. Hand-written (`--custom`): drizzle-kit cannot model functions. Expand-only: ONE
-- `create or replace function` (same signature, same return type, same grants), no table, column, constraint or index change.
--
-- WHAT CHANGES. `app.member_block_create(uuid)` is replaced starting from its NEWEST body, the one in
-- `20261105152916_reports_blocks_functions.sql` (no later migration redefines it), copied statement for statement, with two
-- additions and nothing else:
--
--   1. THE PAIR LOCK (CHAT-07, T-11-04; RESEARCH Pitfall 7). After the target checks and BEFORE the block is written, the
--      function selects the PAIRED direct row of the two users `for update` (tenant, then `least`/`greatest` of the two ids,
--      uuid type, never text, the same encoding as `chat_conversations_direct_pair_uq`). The send guard
--      (`app.chat_messages_before_insert`, plan 06) takes the same row lock and then reads `member_blocks`, so a send holding
--      the lock finishes first and the NEXT send meets the block; a block holding the lock makes a concurrent send wait and
--      then be refused. Lock first, then `member_blocks`: the same order the guard follows. No paired row means no lock and
--      no wait (the empty edge).
--
--   2. THE FOLLOW CLEAN-UP (D-724; T-11-21). After the `on conflict do nothing` insert and its row count, the function
--      deletes from `public.social_follows` the row where the caller follows the blocked member AND the row where the
--      blocked member follows the caller, in the claim's tenant, in the same transaction. It runs on EVERY call, whether or
--      not the block row was new (an out-of-band follow that reappeared is cleared by the second call), and whether or not
--      `social` is on (D-616: the member block is not gated by `social`; D-483 keeps follow rows while `social` is off, so
--      a block made then must still clear them). It is a definer because `social_follows_delete_own` lets a member delete
--      only their own follower-side row. The delete is pinned to the claim's tenant and to the two rows between the caller
--      and the target: another tenant's rows of the same two users, and every follow involving a third member, are untouched.
--
-- WHAT DOES NOT CHANGE. No conversation, message or participant row is deleted (D-723): both participants keep reading the
-- history, because `app.direct_pair_readable` ignores blocks, and only the send guard closes the composer (D-722).
-- Unblocking (`app.member_block_delete`, untouched) restores nothing: the follow rows stay deleted and each side follows
-- again by choice (D-724). No feed, Explorar, community, story or directory filter and no policy on a content table changes
-- (D-725), and `app.is_blocked_by_viewer` is untouched. The preserved Phase 13 behaviours stay: `42501` for a caller with no
-- claims or who is not live, `BL001` for a null target, the caller, a staff, removed, blocked or another tenant's target,
-- `on conflict do nothing`, and the answer `true` only when this call created the block.
--
-- THE BLOCKED MEMBER IS NEVER TOLD (T-11-03). Nothing here is visible to them: they read no `member_blocks` row, the deletion
-- of their follow rows raises nothing for them, and a follow they attempt across the block is refused with the same neutral
-- failure as an unknown target (the policy of `*_follow_block_policy.sql` and the API of plan 11).
create or replace function app.member_block_create(p_blocked uuid)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_n int;
begin
  if v_t is null or v_u is null then
    raise exception 'member_block_create: refused' using errcode = '42501';
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
    raise exception 'member_block_create: refused' using errcode = '42501';
  end if;

  if p_blocked is null or p_blocked = v_u then
    raise exception 'member_block_create: invalid target' using errcode = 'BL001';
  end if;
  if not exists (
    select 1
      from public.memberships m
     where m.tenant_id = v_t
       and m.user_id = p_blocked
       and m.role = 'member'
       and m.status = 'active'
       and m.blocked_at is null
       and m.deleted_at is null
  ) then
    raise exception 'member_block_create: invalid target' using errcode = 'BL001';
  end if;

  -- The pair's conversation lock, taken BEFORE the block is written (the send guard takes it too).
  perform 1
    from public.chat_conversations c
   where c.tenant_id = v_t
     and c.direct_low_user_id = least(v_u, p_blocked)
     and c.direct_high_user_id = greatest(v_u, p_blocked)
     for update;

  insert into public.member_blocks (tenant_id, blocker_user_id, blocked_user_id)
  values (v_t, v_u, p_blocked)
  on conflict do nothing;
  get diagnostics v_n = row_count;

  -- D-724: both follow rows between the caller and the blocked member, this tenant only, on every call.
  delete from public.social_follows f
   where f.tenant_id = v_t
     and ((f.follower_user_id = v_u and f.followee_user_id = p_blocked)
       or (f.follower_user_id = p_blocked and f.followee_user_id = v_u));

  return v_n = 1;
end
$$;
--> statement-breakpoint
revoke all on function app.member_block_create(uuid) from public;--> statement-breakpoint
grant execute on function app.member_block_create(uuid) to authenticated;
