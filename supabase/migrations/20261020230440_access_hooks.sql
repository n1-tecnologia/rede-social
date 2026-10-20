-- access_hooks (09.1-03, D-487, D-491, D-495) — the two Supabase Auth hook functions re-pointed from the
-- retiring global `public.email_allowlist` to the per-tenant `public.access_grants` of 09.1-02. Custom
-- migration (drizzle-kit cannot model functions or grants to `supabase_auth_admin`). The bodies are
-- replaced with `create or replace` UNDER THE SAME NAMES, so `supabase/config.toml` (local blocks and the
-- disabled production blocks), the ACLs and the API revision still serving during `supabase db push` do
-- not change.
--
-- ── WHY COARSE ──────────────────────────────────────────────────────────────────────────────────────
-- GoTrue runs these inside token issuance and account creation, where the HOST (hence the tenant) is
-- unknown: a hook can only answer "does this e-mail have SOME door open?". The real per-tenant rule
-- (this community's gate, this community's access) lives in the API, where the host is known
-- (`signupMember`, `joinTenant`, `requireAuth`). So the hooks stay trivial and cheap:
--   * token hook: pass a platform admin; pass an e-mail with an ACTIVE access row in any tenant; pass a
--     user with a live staff membership (a tenant's own admin is never stranded, D-492); pass a user with
--     a live membership in a tenant whose gate is OFF (assumption A-P1: a tenant that never turned the
--     gate on behaves as it always did, so enabling the production hooks cannot lock out its members);
--     otherwise 403 EMAIL_NOT_ALLOWED.
--   * creation hook: pass only an e-mail with an ACTIVE access row. No pending-invite disjunct: the
--     first-admin path writes a manual access when the invite is created (plan 04, A-P3), and that row is
--     what lets `inviteUserByEmail` through; a second path would be a second rule to keep in step.
--
-- ── CONSEQUENCE (assumption A-P26, to confirm with the user) ────────────────────────────────────────
-- With the production hooks ON, a member who is cut in their ONLY tenant fails the token hook at the next
-- refresh or login (no active access, no staff role, no ungated membership): after the access token lapses
-- they meet the login notice instead of the cut screen. A person cut in one tenant but with active access
-- in another keeps their session (the identity is shared, D-499). Adding one disjunct "any live
-- membership" to the token hook reverses it.
--
-- ── HARDENING (unchanged from the allowlist hooks) ──────────────────────────────────────────────────
-- * SECURITY DEFINER, owner postgres (also the owner of every table read); RLS is NOT forced on them, so
--   the definer reads the zero-policy `access_grants` while `supabase_auth_admin` (no table grants, no
--   bypassrls) cannot read it directly.
-- * `search_path = ''` and fully qualified names; only pg_catalog built-ins and `app.access_gate_on`.
-- * 4xx only: `http_code` is always 403. A 5xx would be retried by supabase-js (auto-refresh storms) and an
--   uncaught SQL exception would answer 500 on EVERY login, so the bodies are index lookups plus one uuid
--   cast on a GoTrue-supplied id that is guarded by a format check (review WR-03).
-- * The platform-admin branch comes first in the token hook, so a data mistake can never lock the
--   platform owner out. The creation hook has no such branch: the user does not exist yet.
-- * The claims are returned EXACTLY as received. GoTrue validates the required set
--   (iss aud exp iat sub role aal session_id email phone is_anonymous); never add or drop one.
-- * EXECUTE is revoked from public/anon/authenticated/service_role and granted only to
--   `supabase_auth_admin`, repeated verbatim so the ACL cannot drift.
--
-- ── RELEASE ORDER ───────────────────────────────────────────────────────────────────────────────────
-- Expand-only: two function bodies replaced; nothing dropped. Production config still ships both hooks
-- `enabled = false`; their enabling is a human rollout step (plan 18).

create or replace function public.hook_custom_access_token_allowlist(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  -- The cast only runs on a well-formed uuid: a malformed id would raise and answer 500 on EVERY login,
  -- so it falls through to the e-mail check instead (review WR-03).
  v_user  uuid := case
                    when event->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    then (event->>'user_id')::uuid
                  end;
  v_email text := lower(btrim(coalesce(event->'claims'->>'email', '')));
begin
  if v_user is not null
     and exists (select 1 from public.platform_admins pa where pa.user_id = v_user) then
    return jsonb_build_object('claims', event->'claims');
  end if;
  if v_email <> ''
     and exists (select 1 from public.access_grants ag
                  where ag.email = v_email and ag.status = 'active') then
    return jsonb_build_object('claims', event->'claims');
  end if;
  if v_user is not null
     and exists (select 1 from public.memberships m
                  where m.user_id = v_user
                    and m.deleted_at is null
                    and (m.role in ('admin_tenant', 'support_tenant')
                         or not app.access_gate_on(m.tenant_id))) then
    return jsonb_build_object('claims', event->'claims');
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'EMAIL_NOT_ALLOWED'));
end
$$;
--> statement-breakpoint
create or replace function public.hook_before_user_created_allowlist(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(event->'user'->>'email', '')));
begin
  if v_email <> ''
     and exists (select 1 from public.access_grants ag
                  where ag.email = v_email and ag.status = 'active') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'EMAIL_NOT_ALLOWED'));
end
$$;
--> statement-breakpoint
revoke all on function public.hook_custom_access_token_allowlist(jsonb)
  from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.hook_custom_access_token_allowlist(jsonb) to supabase_auth_admin;
--> statement-breakpoint
revoke all on function public.hook_before_user_created_allowlist(jsonb)
  from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.hook_before_user_created_allowlist(jsonb) to supabase_auth_admin;
--> statement-breakpoint
grant usage on schema public to supabase_auth_admin;
--> statement-breakpoint
comment on function public.hook_custom_access_token_allowlist(jsonb) is
  'Auth custom_access_token hook (09.1-03): 403 EMAIL_NOT_ALLOWED unless the user is a platform_admin, the e-mail has an active access_grants row in any tenant, or the user has a live staff or ungated-tenant membership. Claims returned unchanged.';
--> statement-breakpoint
comment on function public.hook_before_user_created_allowlist(jsonb) is
  'Auth before_user_created hook (09.1-03): 403 EMAIL_NOT_ALLOWED unless the e-mail has an active access_grants row in some tenant.';
