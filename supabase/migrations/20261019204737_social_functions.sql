-- social_functions (09-02, FOLLOW-01, FOLLOW-03, FOLLOW-04, SOCIAL-06, SOCIAL-10; D-467, D-468, D-483,
-- D-484; RESEARCH Patterns 1 and 2) - the social module's half of the gate seam and the counts
-- definer. Hand-written (`--custom`), applied AFTER the generated `*_social_follows.sql` that created
-- the table these functions read.
--
-- Four groups of statements:
--
--   1. `app.social_enabled()`: the BODY of the kernel stub declared by `*_social_gate_seam.sql`.
--      `social` is on for the caller's tenant when its `tenant_modules` row is enabled. It is a SQL
--      read, NEVER the 30-second flags cache, so turning `social` off hides member content at once on
--      every API instance (D-483). A null tenant claim matches no row and answers false.
--
--   2. `app.social_visible_author_ids()`: the BODY of the second stub. For the role `member` while
--      `social` is on it answers the caller's own user id plus the user ids of the caller's LIVE
--      followees (role `member`, `status = 'active'`, not blocked, not removed: D-484 is true at the
--      RLS layer too, for the cost of one indexed join per statement, an InitPlan); the empty array
--      for every other role, for a null claim and while `social` is off. A staff or null-role claim
--      takes the empty branch and never consults the follow graph (fails closed).
--
--   3. `app.social_counts(p_membership)`: `{ "followers": n, "following": n }` for ONE member, counting
--      only live members on the other end, and NULL when `p_membership` is not a live member of the
--      caller's tenant (staff, blocked, invited, removed, another tenant) or the claim is null. It is
--      the only way a lane learns a number about someone else's relations: two integers, never a row
--      or a name (D-468). The caller is NOT required to be a party, which is the whole point.
--
--   4. The table privileges: `update` and `truncate` on `social_follows` are REVOKED from
--      `authenticated`. With RLS and no update policy an update already touches zero rows, but
--      TRUNCATE is not seen by RLS at all (the `store_orders` / `chat_rls_grants` precedent). The
--      admin lane (`service_role`) keeps its privileges.
--
-- Hardening (T-09-09, the T-06-29 posture): every function is SECURITY DEFINER with `search_path = ''`
-- and fully qualified names. The owner bypasses RLS, so EVERY statement pins `tenant_id =
-- app.tenant_id()` itself: a membership or follow row of another tenant matches nothing. EXECUTE is
-- revoked from PUBLIC and granted to `authenticated` only. Replacing the two seam bodies keeps their
-- signatures and OIDs, so every dependent policy keeps working.

revoke update, truncate on public.social_follows from authenticated;--> statement-breakpoint

create or replace function app.social_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_modules tm
     where tm.tenant_id = app.tenant_id() and tm.module_key = 'social' and tm.enabled)
$$;
--> statement-breakpoint
revoke all on function app.social_enabled() from public;--> statement-breakpoint
grant execute on function app.social_enabled() to authenticated;--> statement-breakpoint

create or replace function app.social_visible_author_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case
    when app.tenant_role() = 'member'
         and app.tenant_id() is not null
         and app.user_id() is not null
         and app.social_enabled()
    then array_append(
      coalesce(
        (select array_agg(f.followee_user_id)
           from public.social_follows f
           join public.memberships m
             on m.tenant_id = f.tenant_id and m.user_id = f.followee_user_id
          where f.tenant_id = app.tenant_id()
            and f.follower_user_id = app.user_id()
            and m.role = 'member' and m.status = 'active'
            and m.blocked_at is null and m.deleted_at is null),
        '{}'::uuid[]),
      app.user_id())
    else '{}'::uuid[]
  end
$$;
--> statement-breakpoint
revoke all on function app.social_visible_author_ids() from public;--> statement-breakpoint
grant execute on function app.social_visible_author_ids() to authenticated;--> statement-breakpoint

create or replace function app.social_counts(p_membership uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'followers',
      (select count(*)::int
         from public.social_follows f
         join public.memberships fm
           on fm.tenant_id = f.tenant_id and fm.user_id = f.follower_user_id
        where f.tenant_id = app.tenant_id()
          and f.followee_user_id = t.user_id
          and fm.role = 'member' and fm.status = 'active'
          and fm.blocked_at is null and fm.deleted_at is null),
    'following',
      (select count(*)::int
         from public.social_follows f
         join public.memberships fm
           on fm.tenant_id = f.tenant_id and fm.user_id = f.followee_user_id
        where f.tenant_id = app.tenant_id()
          and f.follower_user_id = t.user_id
          and fm.role = 'member' and fm.status = 'active'
          and fm.blocked_at is null and fm.deleted_at is null))
    from public.memberships t
   where t.id = p_membership
     and t.tenant_id = app.tenant_id()
     and t.role = 'member' and t.status = 'active'
     and t.blocked_at is null and t.deleted_at is null
$$;
--> statement-breakpoint
revoke all on function app.social_counts(uuid) from public;--> statement-breakpoint
grant execute on function app.social_counts(uuid) to authenticated;
