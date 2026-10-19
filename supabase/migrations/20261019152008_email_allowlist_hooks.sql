-- email_allowlist_hooks (quick 261018-owq) — the two Supabase Auth hook functions that read
-- `public.email_allowlist`, plus the table's privilege hardening. Custom migration (drizzle-kit
-- cannot model functions or grants to `supabase_auth_admin`).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────
-- Only an e-mail listed `liberado` may create an account or receive a token. Three layers enforce it:
--   * `hook_custom_access_token_allowlist` runs inside GoTrue's token issuance for EVERY grant
--     (password, verifyOtp, refresh); a rejection rolls the whole exchange back, so a refused
--     recovery/invite link stays unconsumed and works once the e-mail is listed.
--   * `hook_before_user_created_allowlist` refuses GoTrue's own creation paths (`inviteUserByEmail`,
--     `generateLink` signup/invite, OAuth/SSO).
--   * `auth.admin.createUser` does NOT fire `before_user_created` (verified against GoTrue v2.197.0),
--     which is why the API pre-checks exist (`signupMember`, `createTenant`); the token hook is the
--     backstop for any identity created that way.
--
-- ── HARDENING ───────────────────────────────────────────────────────────────────────────────────────
-- * Both functions are SECURITY DEFINER, owner postgres (also the owner of `email_allowlist` and
--   `platform_admins`), and RLS is NOT forced on either table, so the definer always reads them while
--   `supabase_auth_admin` (no table grants, no bypassrls) cannot read the tables directly.
-- * `search_path = ''` and fully qualified names; only pg_catalog built-ins are used.
-- * 4xx only: `http_code` is always 403. A 5xx would be retried by supabase-js (auto-refresh storms)
--   and an uncaught SQL exception would answer 500 on EVERY login, so the bodies are trivial: PK
--   lookups, plus one uuid cast on a GoTrue-supplied id.
-- * The super_admin branch comes first in the token hook, so a list mistake can never lock the
--   platform owner out. The creation hook has no such branch: the user does not exist yet.
-- * The claims are returned EXACTLY as received. GoTrue validates the required set
--   (iss aud exp iat sub role aal session_id email phone is_anonymous); never add or drop one.
-- * EXECUTE is revoked from public/anon/authenticated/service_role and granted only to
--   `supabase_auth_admin`: the default ACL of `public` hands EXECUTE to anon/authenticated on every
--   new function, so the explicit revoke is mandatory.
--
-- ── RELEASE ORDER ───────────────────────────────────────────────────────────────────────────────────
-- Expand-only: a new table (previous migration) and two new functions; nothing altered or dropped, so
-- the API revision still serving during `supabase db push` is unaffected. Production config ships both
-- hooks `enabled = false`; the functions MUST exist before any hook is enabled, or GoTrue answers 500
-- on every login. deploy-api.yml runs `db push` before `config push`.

revoke all on table public.email_allowlist from anon, authenticated;
--> statement-breakpoint
create or replace function public.hook_custom_access_token_allowlist(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user  uuid := nullif(event->>'user_id', '')::uuid;
  v_email text := lower(btrim(coalesce(event->'claims'->>'email', '')));
begin
  if v_user is not null
     and exists (select 1 from public.platform_admins pa where pa.user_id = v_user) then
    return jsonb_build_object('claims', event->'claims');
  end if;
  if v_email <> ''
     and exists (select 1 from public.email_allowlist a
                  where a.email = v_email and a.status = 'liberado') then
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
     and exists (select 1 from public.email_allowlist a
                  where a.email = v_email and a.status = 'liberado') then
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
  'Auth custom_access_token hook (quick 261018-owq): 403 EMAIL_NOT_ALLOWED unless the e-mail is liberado in public.email_allowlist or the user is a platform_admin. Claims returned unchanged.';
--> statement-breakpoint
comment on function public.hook_before_user_created_allowlist(jsonb) is
  'Auth before_user_created hook (quick 261018-owq): 403 EMAIL_NOT_ALLOWED unless the e-mail is liberado in public.email_allowlist.';
