-- realtime_authorization (07-01) — the FIRST policy ever written on `realtime.messages`, and the ONLY
-- publisher of Realtime signals (SC 4, RESEARCH Patterns 2-4, planning decisions 1-3).
--
-- TOPICS (the spec; `packages/contracts/src/realtime.ts` holds the same regex literal and a unit test
-- pins the two together). Every topic is private and every signal is ids-only:
--   tenant:<t>:all            every LIVE member of <t> while `notifications` is enabled;
--   tenant:<t>:user:<u>       only <u>;
--   tenant:<t>:support-inbox  `admin_tenant` / `support_tenant` while `chat` is enabled;
--   tenant:<t>:conv:<c>       a participant of <c>, or staff on a support conversation, while `chat`
--                             is enabled.
--
-- WHY A SECURITY DEFINER FUNCTION AND NOT A CLAIM OR A PLAIN JOIN (planning decision 1). Realtime
-- evaluates this policy with the user's OWN Supabase JWT in `request.jwt.claims`: it carries `sub`
-- but no `tenant_id` (no custom access token hook exists), so `app.tenant_id()` is NULL here and
-- `memberships` (RLS `tenant_id = app.tenant_id()`) shows nothing to a plain subquery. The function
-- runs as its owner (`postgres`, `rolbypassrls`), so RLS protects NOTHING inside it: every statement
-- scopes itself to the TOPIC's tenant and the caller's own uid. `tenant_modules` is read directly
-- because no `app.module_enabled` helper exists. The staff role list is a literal here; 07-08 pins it
-- against the TypeScript `permissionsFor` with a drift test (RESEARCH Pitfall 4).
--
-- THE TOPIC IS ATTACKER-CHOSEN. It is matched against the regex BEFORE any `::uuid` cast, because a
-- bad cast raises instead of denying, and each id segment is then checked against the canonical
-- 8-4-4-4-12 shape (the regex's `[0-9a-f-]{36}` alone also admits 36 hyphens). Upper-case hex is
-- refused rather than normalised.
--
-- NO INSERT POLICY, ON PURPOSE. `authenticated` holds table grants on `realtime.messages`, so the only
-- thing stopping a browser from publishing a forged signal is the absence of a write policy (T-07-02).
-- Nothing here may add one.
--
-- PUBLISHING (planning decision 2, RESEARCH Pitfall 2). The installed `realtime.send` is SECURITY
-- INVOKER and swallows every error as a WARNING. Called from the tenant lane (`authenticated`, RLS on,
-- no insert policy) it would therefore be a SILENT NO-OP. So every signal comes from definer code:
-- `app.realtime_signal` below, which can only publish inside the CALLER's own tenant
-- (`app.tenant_id()`, never a parameter) and only to one of the four suffix shapes. It is
-- transactional: the row is inserted in the caller's transaction, and Realtime reads committed WAL
-- only, so a rolled-back write publishes nothing. Two alternatives are deliberately NOT used:
--   * row-shipping broadcast triggers ship the whole RECORD, which breaks ids-only;
--   * the REST broadcast endpoint is not transactional (it would announce a write that then rolled
--     back).
-- The installed `realtime.send` also adds an `id` key (the message row's own uuid) to any payload that
-- lacks one, so a delivered payload is `{ kind, id }`: still ids-only.
--
-- Hardening: `set search_path = ''` and fully qualified names, `revoke all … from public` (PUBLIC holds
-- EXECUTE on every new function by default), `grant execute … to authenticated` only. `app` is not a
-- PostgREST-exposed schema (`supabase/config.toml` `[api] schemas`), so neither function is RPC-reachable.

create or replace function app.realtime_topic_allowed(p_topic text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := app.user_id();
  v_parts text[];
  v_tenant uuid;
  v_role text;
begin
  if v_user is null or p_topic is null then
    return false;
  end if;
  -- The spec regex, verbatim (REALTIME_TOPIC_PATTERN), BEFORE any cast.
  if p_topic !~ '^tenant:[0-9a-f-]{36}:(all|support-inbox|user:[0-9a-f-]{36}|conv:[0-9a-f-]{36})$' then
    return false;
  end if;
  v_parts := string_to_array(p_topic, ':');
  -- Canonical uuid shape on every id segment, so the casts below can never raise.
  if v_parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if array_length(v_parts, 1) = 4
     and v_parts[4] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_tenant := v_parts[2]::uuid;

  -- A LIVE membership of THAT tenant, in an ACTIVE tenant. No row: not a member there, blocked,
  -- removed, invited, or the tenant is suspended.
  select m.role
    into v_role
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.tenant_id = v_tenant
     and m.user_id = v_user
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null
     and t.status = 'active'
   limit 1;
  if v_role is null then
    return false;
  end if;

  if v_parts[3] = 'all' then
    return exists (
      select 1
        from public.tenant_modules tm
       where tm.tenant_id = v_tenant
         and tm.module_key = 'notifications'
         and tm.enabled
    );
  elsif v_parts[3] = 'user' then
    return v_parts[4]::uuid = v_user;
  elsif v_parts[3] = 'support-inbox' then
    return v_role in ('admin_tenant', 'support_tenant')
       and exists (
         select 1
           from public.tenant_modules tm
          where tm.tenant_id = v_tenant
            and tm.module_key = 'chat'
            and tm.enabled
       );
  elsif v_parts[3] = 'conv' then
    return exists (
             select 1
               from public.tenant_modules tm
              where tm.tenant_id = v_tenant
                and tm.module_key = 'chat'
                and tm.enabled
           )
       and exists (
             select 1
               from public.chat_conversations c
              where c.id = v_parts[4]::uuid
                and c.tenant_id = v_tenant
                and (
                  exists (
                    select 1
                      from public.chat_participants p
                     where p.conversation_id = c.id
                       and p.tenant_id = v_tenant
                       and p.user_id = v_user
                  )
                  or (c.kind = 'support' and v_role in ('admin_tenant', 'support_tenant'))
                )
           );
  end if;
  return false;
end
$$;
--> statement-breakpoint
revoke all on function app.realtime_topic_allowed(text) from public;--> statement-breakpoint
grant execute on function app.realtime_topic_allowed(text) to authenticated;--> statement-breakpoint

-- The ONE policy on `realtime.messages`: SELECT (join / receive) for `authenticated`, decided by the
-- definer above. The nested `select`s let the planner evaluate the function once per statement.
create policy realtime_tenant_topics_select on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select app.realtime_topic_allowed((select realtime.topic())))
  );--> statement-breakpoint

-- The ONLY publisher. The tenant half of the topic is the caller's own claim, never a parameter; the
-- suffix must be one of the four shapes (REALTIME_SUFFIX_PATTERN). A lane without a tenant claim, or
-- a bad suffix, is refused LOUDLY (42501): unlike `realtime.send`, this never fails silently on input.
create or replace function app.realtime_signal(p_suffix text, p_event text, p_payload jsonb)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
begin
  if v_tenant is null
     or p_suffix is null
     or p_suffix !~ '^(all|support-inbox|user:[0-9a-f-]{36}|conv:[0-9a-f-]{36})$'
     or p_event is null then
    raise exception 'realtime_signal: refused' using errcode = '42501';
  end if;
  perform realtime.send(
    coalesce(p_payload, '{}'::jsonb),
    p_event,
    'tenant:' || v_tenant::text || ':' || p_suffix,
    true
  );
end
$$;
--> statement-breakpoint
revoke all on function app.realtime_signal(text, text, jsonb) from public;--> statement-breakpoint
grant execute on function app.realtime_signal(text, text, jsonb) to authenticated;
