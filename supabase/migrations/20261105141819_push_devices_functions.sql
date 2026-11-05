-- push_devices_functions (Phase 13, NATIVE-08; D-606, D-603; T-13-11, T-13-12) — the native writer, the native
-- reader, and the old reader narrowed to web rows. Hand-written (`--custom`): drizzle-kit cannot model functions.
-- Its companion `*_push_devices.sql` is the GENERATED half (the widened `push_subscriptions` table and its CHECKs);
-- this file is sorted AFTER it and calls nothing it does not create.
--
-- EXPAND-ONLY and rolling-deploy safe (D-603, NATIVE-32). The shipped 4-argument `app.push_subscription_upsert`
-- is NOT touched. The old reader `app.push_subscriptions_for` keeps its exact signature and return type but is
-- narrowed to `kind = 'webpush'`: a worker still running the previous revision reads this function, and a native
-- row has null keys it would fail to encrypt for. The native read is a NEW function. Deploy order is migration,
-- then API, then worker (the order `deploy-api.yml` documents).
--
-- The conventions of `20260930180227_push_subscriptions_functions.sql` carry over unchanged: `security definer`,
-- `set search_path = ''`, fully qualified names, `tenant_id = app.tenant_id()` in EVERY statement (the owner is
-- `postgres`, which has `rolbypassrls`, so RLS protects nothing in here), SQLSTATE 42501 without a tenant and user
-- claim or without a LIVE membership (`status = 'active' and blocked_at is null and deleted_at is null`),
-- `revoke all … from public`. `app` is not a PostgREST-exposed schema, so none of this is RPC-reachable.
--
-- A native device token is a delivery credential for ONE member's phone (T-13-11): no function here puts it in an
-- error message, a notice or a return other than the reader's `endpoint` column (read by the send job only).

-- ── app.push_device_upsert ────────────────────────────────────────────────────────────────────────────
-- The member's own save of an iOS (`apns`) or Android (`fcm`) device token (plan 11's `POST …/devices`). Requires
-- `app.user_id()` and a LIVE membership of the caller in the claim's tenant (a blocked member cannot re-arm a
-- device). The device HANDOFF of the web writer carries over: any row of the same token in the tenant that
-- belongs to ANOTHER user is deleted first (the phone changed hands: the previous owner's pushes stop); a token
-- held in ANOTHER tenant is a different row and is never touched. The caller's row is then inserted, or refreshed in
-- place when the caller already owns the token (the id is kept; `app_version` and `app_environment` are refreshed,
-- `failure_count` is cleared because the app just proved the token alive, and `created_at` and `last_success_at`
-- are left alone). The conflict branch also rewrites `user_id`, so two concurrent saves of one token by different
-- members still leave exactly one owner. The strict shape check of the token (hex or FCM alphabet) is the API's
-- job in plan 11; the pairing, the length bounds and the environment are checked here as the last line of defence
-- (22023, message without the token). Returns the row id.
create or replace function app.push_device_upsert(
  p_kind text,
  p_token text,
  p_platform text,
  p_environment text,
  p_app_version text
)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_id uuid;
begin
  if v_t is null or v_u is null then
    raise exception 'push_device_upsert: refused' using errcode = '42501';
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
    raise exception 'push_device_upsert: refused' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('apns', 'fcm')
     or p_platform is null
     or not ((p_kind = 'apns' and p_platform = 'ios') or (p_kind = 'fcm' and p_platform = 'android'))
     or p_token is null or length(p_token) < 32 or length(p_token) > 4096
     or p_environment is null or p_environment not in ('production', 'sandbox') then
    raise exception 'push_device_upsert: invalid device' using errcode = '22023';
  end if;

  delete from public.push_subscriptions s
   where s.tenant_id = v_t
     and s.endpoint = p_token
     and s.user_id <> v_u;

  insert into public.push_subscriptions as s
    (tenant_id, user_id, endpoint, kind, platform, app_environment, app_version)
  values (v_t, v_u, p_token, p_kind, p_platform, p_environment, left(p_app_version, 64))
  on conflict (tenant_id, endpoint) do update
     set user_id = excluded.user_id,
         kind = excluded.kind,
         platform = excluded.platform,
         app_environment = excluded.app_environment,
         app_version = excluded.app_version,
         p256dh = null,
         auth = null,
         failure_count = 0
  returning s.id into v_id;

  return v_id;
end
$$;
--> statement-breakpoint
revoke all on function app.push_device_upsert(text, text, text, text, text) from public;--> statement-breakpoint
grant execute on function app.push_device_upsert(text, text, text, text, text) to authenticated;--> statement-breakpoint

-- ── app.push_subscriptions_for (replaced: web rows only) ──────────────────────────────────────────────
-- The same signature, the same return table and the same body as the shipped function (07-06), plus ONE
-- predicate: `s.kind = 'webpush'`. A previous-revision worker reads this function and cannot send to a native
-- row (null keys), so it must never see one (T-13-12). The new worker reads `_for_v2` below.
create or replace function app.push_subscriptions_for(p_user_ids uuid[])
returns table (id uuid, user_id uuid, role text, endpoint text, p256dh text, auth text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
begin
  if v_t is null then
    raise exception 'push_subscriptions_for: refused' using errcode = '42501';
  end if;

  return query
  select s.id, s.user_id, m.role::text, s.endpoint, s.p256dh, s.auth
    from public.push_subscriptions s
    join public.memberships m
      on m.tenant_id = s.tenant_id
     and m.user_id = s.user_id
   where s.tenant_id = v_t
     and s.kind = 'webpush'
     and s.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null
   order by s.user_id, s.created_at, s.id;
end
$$;
--> statement-breakpoint
revoke all on function app.push_subscriptions_for(uuid[]) from public;--> statement-breakpoint
grant execute on function app.push_subscriptions_for(uuid[]) to authenticated;--> statement-breakpoint

-- ── app.push_subscriptions_for_v2 ─────────────────────────────────────────────────────────────────────
-- The send job's read of EVERY kind (plan 12): the old function's columns plus `kind`, `platform`,
-- `app_environment` and `app_version`, with the same live-member join and the same tenant pinning. For a native
-- row `endpoint` is the device token and `p256dh` / `auth` are null. A listed user of another tenant, or a
-- blocked or departed one, contributes nothing. Like its web predecessor it is executable by `authenticated`:
-- the send job runs in the tenant lane (`withTenantTx`, which switches to `authenticated`) under the
-- notifications system claim, so a narrower grant would lock the one caller it exists for. `service_role` and
-- the connection role `api_user` are granted too; neither can read anything without a tenant claim (42501).
create or replace function app.push_subscriptions_for_v2(p_user_ids uuid[])
returns table (
  id uuid,
  user_id uuid,
  role text,
  endpoint text,
  p256dh text,
  auth text,
  kind text,
  platform text,
  app_environment text,
  app_version text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
begin
  if v_t is null then
    raise exception 'push_subscriptions_for_v2: refused' using errcode = '42501';
  end if;

  return query
  select s.id, s.user_id, m.role::text, s.endpoint, s.p256dh, s.auth,
         s.kind, s.platform, s.app_environment, s.app_version
    from public.push_subscriptions s
    join public.memberships m
      on m.tenant_id = s.tenant_id
     and m.user_id = s.user_id
   where s.tenant_id = v_t
     and s.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null
   order by s.user_id, s.created_at, s.id;
end
$$;
--> statement-breakpoint
revoke all on function app.push_subscriptions_for_v2(uuid[]) from public;--> statement-breakpoint
grant execute on function app.push_subscriptions_for_v2(uuid[]) to authenticated, service_role, api_user;
