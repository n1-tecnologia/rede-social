-- direct_pair_gates (Phase 11, CHAT-06; D-719, D-720, D-721, D-482, D-483; T-11-01, T-11-02, T-11-19) — the four helper
-- functions that decide whether TWO members of one tenant may share a direct conversation. Hand-written (`--custom`):
-- drizzle-kit cannot model functions. This file is sorted BEFORE `*_direct_pairs.sql` (the generated columns, CHECKs and
-- index) and `*_direct_policies.sql` (the policy edits that call `app.direct_pair_readable`), so the policy migration
-- always finds its function. Nothing here touches a table: expand-only.
--
-- THE OPEN PAIR. A pair is open when `social` is on for the tenant, both users hold a LIVE membership with role `member`
-- (`status = 'active'`, `blocked_at` and `deleted_at` null: the fan-out's predicate, D-229) and no `member_blocks` row
-- stands in either direction. Staff (`admin_tenant`, `support_tenant`) never take part (D-482), so the role is part of
-- the answer. Every statement pins `tenant_id`; the owner is `postgres` (`rolbypassrls`), so RLS protects nothing inside
-- a definer and the tenant scope is the function's own, exactly like `20261105152916_reports_blocks_functions.sql`.
--
-- THE FOUR (plus the creator in `*_direct_open.sql`):
--   app.pair_open_in(tenant, a, b)   the explicit-tenant answer. NO lane may execute it (revoked from public, anon and
--                                    authenticated): a lane-callable copy would let any caller ask about any tenant
--                                    (T-11-19). Only other definers and triggers run it.
--   app.members_blocked_between(o)   caller-relative: did the caller block `o`, or `o` the caller? The blocked side can
--                                    ask without reading `member_blocks` (it has no row to read).
--   app.social_pair_open(a, b)       the open-pair answer pinned to the claim's tenant, for the notifications WORKER
--                                    only: any caller whose user is not the zero system user is refused 42501, because
--                                    any other lane could otherwise probe whether two OTHER members blocked each other.
--   app.direct_pair_readable(a, b)   the policy predicate of `chat_conversations_select`: `social` on and each of the two
--                                    users a `member` who is either live or anonymised (an anonymised account stays
--                                    readable, D-721). An administrator-blocked or removed member makes the pair
--                                    unreadable for the OTHER participant; nothing is deleted and the pair returns whole
--                                    when the block lifts. It is NOT a check that the caller is one of the two: the
--                                    participant term of the policy does that.
--
-- `app.social_enabled()` is the SQL read of `tenant_modules` (never the 30-second flags cache), so turning `social` off
-- hides the pair at once (D-483).

-- ── app.pair_open_in ──────────────────────────────────────────────────────────────────────────────────
create or replace function app.pair_open_in(p_tenant uuid, p_a uuid, p_b uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_tenant is not null
     and p_a is not null
     and p_b is not null
     and p_a <> p_b
     and exists (
       select 1
         from public.tenant_modules tm
        where tm.tenant_id = p_tenant
          and tm.module_key = 'social'
          and tm.enabled)
     and (
       select count(distinct m.user_id)
         from public.memberships m
        where m.tenant_id = p_tenant
          and m.user_id in (p_a, p_b)
          and m.role = 'member'
          and m.status = 'active'
          and m.blocked_at is null
          and m.deleted_at is null) = 2
     and not exists (
       select 1
         from public.member_blocks b
        where b.tenant_id = p_tenant
          and ((b.blocker_user_id = p_a and b.blocked_user_id = p_b)
            or (b.blocker_user_id = p_b and b.blocked_user_id = p_a)))
$$;
--> statement-breakpoint
revoke all on function app.pair_open_in(uuid, uuid, uuid) from public, anon, authenticated;--> statement-breakpoint

-- ── app.members_blocked_between ───────────────────────────────────────────────────────────────────────
create or replace function app.members_blocked_between(p_other uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.member_blocks b
     where b.tenant_id = app.tenant_id()
       and ((b.blocker_user_id = app.user_id() and b.blocked_user_id = p_other)
         or (b.blocker_user_id = p_other and b.blocked_user_id = app.user_id())))
$$;
--> statement-breakpoint
revoke all on function app.members_blocked_between(uuid) from public;--> statement-breakpoint
grant execute on function app.members_blocked_between(uuid) to authenticated;--> statement-breakpoint

-- ── app.social_pair_open ──────────────────────────────────────────────────────────────────────────────
create or replace function app.social_pair_open(p_a uuid, p_b uuid)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.tenant_id() is null
     or app.user_id() is distinct from '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'social_pair_open: system lane only' using errcode = '42501';
  end if;
  return app.pair_open_in(app.tenant_id(), p_a, p_b);
end
$$;
--> statement-breakpoint
revoke all on function app.social_pair_open(uuid, uuid) from public;--> statement-breakpoint
grant execute on function app.social_pair_open(uuid, uuid) to authenticated;--> statement-breakpoint

-- ── app.direct_pair_readable ──────────────────────────────────────────────────────────────────────────
create or replace function app.direct_pair_readable(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.tenant_id() is not null
     and p_a is not null
     and p_b is not null
     and app.social_enabled()
     and (
       select count(distinct m.user_id)
         from public.memberships m
        where m.tenant_id = app.tenant_id()
          and m.user_id in (p_a, p_b)
          and m.role = 'member'
          and ((m.status = 'active' and m.blocked_at is null and m.deleted_at is null)
            or m.anonymised_at is not null)) = 2
$$;
--> statement-breakpoint
revoke all on function app.direct_pair_readable(uuid, uuid) from public;--> statement-breakpoint
grant execute on function app.direct_pair_readable(uuid, uuid) to authenticated;
