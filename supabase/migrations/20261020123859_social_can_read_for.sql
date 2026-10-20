-- social_can_read_for (09-14, gap G1 of 09-VERIFICATION = WR-02; SOCIAL-06; D-483, D-484, D-468;
-- T-09-51, T-09-52) — `app.social_can_read_for(p_user, p_author) boolean`, the explicit-user form of the
-- social read gate. Hand-written (`--custom`). Nothing calls it until the notifications worker is wired in
-- plan 09-15.
--
-- WHY IT EXISTS. The reply notice ("someone commented on your followers post") is resolved by the
-- notifications worker, which runs as the system lane (role `support_tenant`, the zero user). The
-- claims-based `app.social_visible_author_ids()` answers the EMPTY ARRAY for that role, so it cannot say
-- whether a given RECIPIENT may still read a given AUTHOR's posts, and the feed module may not read the
-- social module's table itself (MOD-02). This is the explicit-user mirror of
-- `app.community_locked_ids_for(p_user)` (08.2, `*_store_functions.sql`): the module asks the kernel, the
-- kernel reads the graph.
--
-- THE RULE. TRUE only when ALL of:
--   * the caller has a tenant claim and `social` is enabled for it (D-483: off hides everything, the
--     admin included);
--   * the caller is allowed to ask: `p_user` is the caller's own id, OR the caller is the system lane (the
--     zero user). THIS CLOSES THE FOLLOW-GRAPH ORACLE (D-468: counts are public, lists are private): any
--     other lane learns an answer only about ITSELF, so a member cannot ask whether a third member follows
--     another. The system lane already reads every membership, so asking costs it nothing;
--   * `p_author` is a live `member` of the tenant (`status = 'active'`, not blocked, not removed: D-484);
--   * and the recipient test holds: `p_user` is a live `admin_tenant` (the moderator, exempt as in
--     `feed_posts_social_gate`; a real `support_tenant` is NOT), OR a live `member` who is `p_author` or has
--     a `social_follows` row for `p_author` (the same conditions `app.social_visible_author_ids()` applies
--     to a followee).
-- A null, unknown or mismatched input (another tenant's id) matches no row and answers FALSE; the whole
-- expression is wrapped in `coalesce(…, false)`, so the function never answers null and never raises.
--
-- Hardening (T-09-52, the T-06-29 posture): SECURITY DEFINER, `search_path = ''`, fully qualified names.
-- The owner bypasses RLS, so EVERY statement pins `tenant_id = app.tenant_id()` itself. EXECUTE is revoked
-- from PUBLIC and granted to `authenticated` only. `exists` subqueries; no single-row pick clause
-- (pgTAP 040 pins the set of app functions that use one). Expand-only: one new function.

create or replace function app.social_can_read_for(p_user uuid, p_author uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    app.tenant_id() is not null
    and p_user is not null
    and p_author is not null
    and app.social_enabled()
    and (p_user = app.user_id()
         or app.user_id() = '00000000-0000-0000-0000-000000000000'::uuid)
    and exists (
      select 1
        from public.memberships a
       where a.tenant_id = app.tenant_id()
         and a.user_id = p_author
         and a.role = 'member' and a.status = 'active'
         and a.blocked_at is null and a.deleted_at is null)
    and (
      exists (
        select 1
          from public.memberships r
         where r.tenant_id = app.tenant_id()
           and r.user_id = p_user
           and r.role = 'admin_tenant' and r.status = 'active'
           and r.blocked_at is null and r.deleted_at is null)
      or (
        exists (
          select 1
            from public.memberships r
           where r.tenant_id = app.tenant_id()
             and r.user_id = p_user
             and r.role = 'member' and r.status = 'active'
             and r.blocked_at is null and r.deleted_at is null)
        and (
          p_user = p_author
          or exists (
            select 1
              from public.social_follows f
              join public.memberships fm
                on fm.tenant_id = f.tenant_id and fm.user_id = f.followee_user_id
             where f.tenant_id = app.tenant_id()
               and f.follower_user_id = p_user
               and f.followee_user_id = p_author
               and fm.role = 'member' and fm.status = 'active'
               and fm.blocked_at is null and fm.deleted_at is null)))),
    false)
$$;
--> statement-breakpoint
revoke all on function app.social_can_read_for(uuid, uuid) from public;--> statement-breakpoint
grant execute on function app.social_can_read_for(uuid, uuid) to authenticated;
