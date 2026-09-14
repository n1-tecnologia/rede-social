-- membership_lookup_lifecycle (phase-1 review WR-08): app.membership_for_user() is the ONLY lookup
-- requireAuth runs, so it must be the single source of truth for the lifecycle columns the schema
-- already carries. Before this migration it filtered on nothing but user_id, and requireAuth checked
-- only `status`: a moderation action that set `deleted_at` (or `blocked_at`) without also flipping
-- `status` left the member fully authenticated.
--
-- Semantics, now enforced here and nowhere else:
--   * `deleted_at is not null`  -> the membership is gone: no row, requireAuth answers NO_MEMBERSHIP
--   * `blocked_at is not null`  -> reported as status 'blocked' regardless of the `status` column,
--                                   so requireAuth's existing `status === 'blocked'` check fires
--   * otherwise                  -> the stored `status`
--
-- `order by m.joined_at limit 1` is kept verbatim: 040-schema-conventions asserts both (the V1
-- single membership is picked deterministically, and this is the only app function that picks one
-- row). Same signature, same grants: `create or replace` keeps the api_user EXECUTE grant.
create or replace function app.membership_for_user(p_user_id uuid)
returns table (
  tenant_id uuid,
  tenant_slug text,
  tenant_display_name text,
  role text,
  status text,
  tenant_status text
)
language sql stable security definer set search_path = '' as $$
  select m.tenant_id,
         t.slug,
         t.display_name,
         m.role,
         case when m.blocked_at is not null then 'blocked' else m.status end,
         t.status
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id
    and m.deleted_at is null
  order by m.joined_at
  limit 1
$$;
