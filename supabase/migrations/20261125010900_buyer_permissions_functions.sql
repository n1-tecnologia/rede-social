-- buyer_permissions_functions (11.1-02; BPERM-01..05, BPERM-25; D-880, D-886, D-887, D-888, D-891, D-892) — the ONE SQL
-- definition of "which actions does this member hold in this community", and the two wrappers every gate and every
-- projection reads. Hand-written, so it sorts BETWEEN the generated `*_buyer_permissions_columns.sql` (the flag columns
-- it reads) and the generated `*_buyer_permissions_post_gate.sql` (the policy that calls it): `CREATE POLICY` must
-- resolve `app.community_action_allowed` when it runs, and a SQL-language body is validated at creation (EP-54, the
-- `community_gate_seam` precedent).
--
-- THE UNION (D-886, D-887). A member's grant in a community is the `bool_or` of each flag over every product linked to
-- that community for which the caller holds an `e.status = 'active'` entitlement. It ignores `expires_at` EXACTLY like
-- the access OR of `app.community_locked_ids()` (`*_store_functions.sql`), so access and grant stay in lockstep, and it
-- reads the entitlement at statement time, so a revoked, refunded or cancelled entitlement stops granting at the NEXT
-- statement (D-887; the gateway path sets `status = 'revoked'`). What the buyer already published stays.
--
-- FAIL CLOSED (D-892, D-888). The scope function holds a grant only for an EXPLICIT `member` claim with a tenant and a
-- user; staff, a null role and a lane with no claims get the empty map. It ranges only over ORGANIZATION communities of
-- the caller's tenant that are not soft-deleted, and only while the `store` module is on. The denied-ids wrapper reads
-- the role from the claim like `community_locked_ids` does: staff by claim get the empty set, and a null or unknown
-- role takes the member branch and DENIES.
--
-- THE SEAM. `app.community_action_allowed(uuid, text)` is the constant-false stub of `*_member_communities_functions.sql`;
-- it is replaced here with `create or replace`, SAME signature and attributes, so `feed_posts_social_insert_gate` keeps
-- the function OID. The answer is true only for the five lowercase names like, comment, share, post and story, NEVER for
-- `openHighlight` (that key rides the map for the highlight screens), a case variant, an unknown name or a null.
-- `app.community_action_denied_ids(text)` is declared first as a KERNEL stub returning the empty set (a project that
-- reuses feed without the store keeps it), then given the store body below.
--
-- Hardening (the T-06-29 posture): SECURITY DEFINER, `search_path = ''`, fully qualified names. The owner bypasses RLS,
-- so EVERY statement pins `tenant_id = app.tenant_id()` itself and the caller's own entitlements by `app.user_id()`;
-- another tenant's community, product or highlight matches nothing. EXECUTE is revoked from PUBLIC and granted to
-- `authenticated` only. No body uses the single-row pick clause that `040-schema-conventions.sql` allow-lists.

-- the kernel stub of the lane wrapper: no community is denied (every community is open)
create or replace function app.community_action_denied_ids(p_action text) returns uuid[]
language sql stable security definer set search_path = '' as $$ select '{}'::uuid[] $$;
--> statement-breakpoint
revoke all on function app.community_action_denied_ids(text) from public;--> statement-breakpoint
grant execute on function app.community_action_denied_ids(text) to authenticated;--> statement-breakpoint

-- plpgsql, so the highlight column binds at the first call and not at creation
create or replace function app.community_buyer_scope() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  -- fail closed: only an explicit member claim with a tenant and a user holds a product grant
  if app.tenant_id() is null or app.user_id() is null
     or app.tenant_role() is distinct from 'member' then
    return '{}'::jsonb;
  end if;
  return coalesce((
    select jsonb_object_agg(g.community_id::text, jsonb_build_object(
             'like', g.can_like, 'comment', g.can_comment, 'share', g.can_share,
             'post', g.can_post, 'story', g.can_story, 'openHighlight', g.open_highlight))
      from (
        select l.community_id,
               bool_or(l.can_like) as can_like,
               bool_or(l.can_comment) as can_comment,
               bool_or(l.can_share) as can_share,
               bool_or(l.can_post) as can_post,
               bool_or(l.can_story) as can_story,
               exists (select 1 from public.story_highlights h
                        where h.tenant_id = l.tenant_id
                          and h.community_id = l.community_id
                          and h.open_to_buyers) as open_highlight
          from public.store_product_communities l
          join public.store_entitlements e
            on e.tenant_id = l.tenant_id and e.product_id = l.product_id
          join public.communities c
            on c.id = l.community_id and c.tenant_id = l.tenant_id
         where l.tenant_id = app.tenant_id()
           and e.user_id = app.user_id()
           and e.status = 'active'
           and c.kind = 'organization'
           and c.deleted_at is null
           and exists (select 1 from public.tenant_modules tm
                        where tm.tenant_id = l.tenant_id and tm.module_key = 'store' and tm.enabled)
         group by l.tenant_id, l.community_id) g), '{}'::jsonb);
end
$$;
--> statement-breakpoint
revoke all on function app.community_buyer_scope() from public;--> statement-breakpoint
grant execute on function app.community_buyer_scope() to authenticated;--> statement-breakpoint

-- replaces the constant-false stub (same signature and attributes, so the dependent policy keeps the OID)
create or replace function app.community_action_allowed(p_community_id uuid, p_action text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
           p_action in ('like', 'comment', 'share', 'post', 'story')
           and ((select app.community_buyer_scope()) -> (p_community_id::text) ->> p_action) = 'true',
           false)
$$;
--> statement-breakpoint
revoke all on function app.community_action_allowed(uuid, text) from public;--> statement-breakpoint
grant execute on function app.community_action_allowed(uuid, text) to authenticated;--> statement-breakpoint

-- the lane form (the like and comment gates of plan 03): the organization communities of the caller's tenant that carry
-- a link and where the action is NOT held. A community with no linked product is never in the set (D-892); staff by
-- claim get the empty set; a null or unknown role takes the member branch and denies.
create or replace function app.community_action_denied_ids(p_action text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case
    when app.tenant_role() in ('admin_tenant', 'support_tenant') then '{}'::uuid[]
    else (
      select coalesce(array_agg(distinct l.community_id), '{}'::uuid[])
        from public.store_product_communities l
        join public.communities c
          on c.id = l.community_id and c.tenant_id = l.tenant_id
       where l.tenant_id = app.tenant_id()
         and c.kind = 'organization'
         and exists (select 1 from public.tenant_modules tm
                      where tm.tenant_id = l.tenant_id and tm.module_key = 'store' and tm.enabled)
         and not coalesce(
               p_action in ('like', 'comment', 'share', 'post', 'story')
               and ((select app.community_buyer_scope()) -> (l.community_id::text) ->> p_action) = 'true',
               false))
  end
$$;
