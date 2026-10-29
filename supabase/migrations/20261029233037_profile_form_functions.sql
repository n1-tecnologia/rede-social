-- profile_form_functions (Phase 12, PFORM-09, PFORM-17, PFORM-18, PFORM-25; D-581, D-585, D-587, D-593; T-12-08, T-12-09, T-12-10) —
-- the SQL rule behind the profile form gate, the `_gate` successors of the payment lookup pair, and the guard
-- trigger that makes the D-587 locks a database fact. Custom migration (drizzle-kit cannot model functions, triggers
-- or grants). Its generated companion `20261029232606_profile_form_tables.sql` creates the two tables.
--
-- ── ONE RULE, IN SQL ────────────────────────────────────────────────────────────────────────────────
--   * `app.profile_form_missing(tenant, membership)` is D-585 LITERALLY: the number of ACTIVE REQUIRED questions the
--     membership has no answer row for. Completeness is COMPUTED, never stored: no flag, no counter and no per-type
--     logic here, because validity is enforced at write time and the locks below forbid narrowing, so "has an answer
--     row" IS "has a valid answer". A single `case` fixes the order of the short circuits (a plain `A and B` of two
--     EXISTS gives no ordering guarantee): 0 unless the `profile_form` module row of the tenant is enabled, 0 unless
--     the membership is a live `member` of THAT tenant (D-584: staff are never held), else a count over the partial
--     index of required questions with one unique-index probe per question. A tenant with the module off pays one
--     primary-key probe per request.
--   * `app.profile_form_missing_self()` is the same rule for the caller: it derives the membership from the session
--     claims, so a tenant session can never ask about another member (T-12-08).
--   * `app.membership_in_tenant_gate` / `app.memberships_of_user_gate` return the seven columns of the `_gated` twins
--     PLUS `profile_form_missing`, computed in the SAME statement, so `requireAuth` takes the membership, the payment
--     cut and the pending form in one definer round trip and one snapshot.
--   * `app.profile_form_question_guard()` is a BEFORE UPDATE trigger that, once a question has at least one answer,
--     refuses with a custom SQLSTATE: PF001 a type change; PF002 removing or relabelling an option that has answers;
--     PF003 turning `allow_other` off while an "Outro" answer exists; PF004 `show_on_profile` from false to true (the
--     one-way ratchet toward private, PU-1); PF005 narrowing a number or date limit. Title, help text, `required`,
--     position, archive state, `revision` and ADDING options stay free. The service of plan 08 checks the same rules
--     first and maps the five codes to coded 409s; this trigger is the backstop. It is SECURITY DEFINER so its
--     "has answers" probe sees every answer regardless of the editing session's own row policies.
--
-- ── HARDENING ───────────────────────────────────────────────────────────────────────────────────────
-- * SECURITY DEFINER, owner postgres (also the owner of the tables read), RLS not forced, `search_path = ''` and
--   fully qualified names.
-- * EXECUTE is revoked from PUBLIC (the default ACL of `public` hands it to anon/authenticated). The two-argument
--   rule and the two `_gate` twins are granted to `api_user` (the request path) and `service_role` (the admin lane);
--   `authenticated` gets only the no-argument `_self` variant. The guard function is granted to nobody.
-- * TRUNCATE is revoked from `authenticated` on the two tables: it is not subject to row-level security, and
--   Supabase's default privileges hand it to every lane. A tenant lane must never be able to empty every tenant's
--   answers (T-12-06), the same lesson as `20261009084554_store_admin_write_truncate.sql`.
--
-- ── RELEASE ORDER ───────────────────────────────────────────────────────────────────────────────────
-- Expand-only: new functions, one trigger on a table created one migration earlier, and a privilege revoke on the
-- same tables. `app.membership_in_tenant_gated` and `app.memberships_of_user_gated` are NOT touched, so the API
-- revision still serving during the fan-out keeps working; the new revision calls the `_gate` twins. Dropping the old
-- `_gated` pair is a later cleanup migration once the API that calls `_gate` has been live for one release (the
-- 08.1-05 `membership_for_user` precedent). No tenant is backfilled.

revoke truncate on public.profile_form_questions from authenticated;
--> statement-breakpoint
revoke truncate on public.profile_form_answers from authenticated;
--> statement-breakpoint
create or replace function app.profile_form_missing(p_tenant uuid, p_membership uuid)
returns integer
language sql stable security definer set search_path = '' as $$
  select case
    -- 1. module off or no row: one primary-key probe, then done (the whole cost of a tenant without the module)
    when not exists (
      select 1
      from public.tenant_modules tm
      where tm.tenant_id = p_tenant
        and tm.module_key = 'profile_form'
        and tm.enabled
    ) then 0
    -- 2. only the role `member` is ever held (D-584): a live membership of THIS tenant
    when not exists (
      select 1
      from public.memberships m
      where m.id = p_membership
        and m.tenant_id = p_tenant
        and m.role = 'member'
        and m.deleted_at is null
    ) then 0
    -- 3. active required questions the member has no answer row for (partial index, then unique-index probes)
    else (
      select count(*)::int
      from public.profile_form_questions q
      where q.tenant_id = p_tenant
        and q.required
        and q.archived_at is null
        and not exists (
          select 1
          from public.profile_form_answers a
          where a.tenant_id = q.tenant_id
            and a.membership_id = p_membership
            and a.question_id = q.id
        )
    )
  end
$$;
--> statement-breakpoint
create or replace function app.profile_form_missing_self()
returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (
      select app.profile_form_missing(m.tenant_id, m.id)
      from public.memberships m
      where m.tenant_id = app.tenant_id()
        and m.user_id = app.user_id()
        and m.deleted_at is null
    ),
    0
  )
$$;
--> statement-breakpoint
create or replace function app.membership_in_tenant_gate(p_user_id uuid, p_tenant_id uuid)
returns table (
  tenant_id uuid,
  tenant_slug text,
  tenant_display_name text,
  role text,
  status text,
  tenant_status text,
  access_state text,
  profile_form_missing integer
)
language sql stable security definer set search_path = '' as $$
  select m.tenant_id,
         t.slug,
         t.display_name,
         m.role,
         case when m.blocked_at is not null then 'blocked' else m.status end,
         t.status,
         app.access_state(m.tenant_id, m.user_id),
         app.profile_form_missing(m.tenant_id, m.id)
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id
    and m.tenant_id = p_tenant_id
    and m.deleted_at is null
$$;
--> statement-breakpoint
create or replace function app.memberships_of_user_gate(p_user_id uuid)
returns table (
  tenant_id uuid,
  tenant_slug text,
  tenant_display_name text,
  role text,
  status text,
  tenant_status text,
  access_state text,
  profile_form_missing integer
)
language sql stable security definer set search_path = '' as $$
  select m.tenant_id,
         t.slug,
         t.display_name,
         m.role,
         case when m.blocked_at is not null then 'blocked' else m.status end,
         t.status,
         app.access_state(m.tenant_id, m.user_id),
         app.profile_form_missing(m.tenant_id, m.id)
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id
    and m.deleted_at is null
  order by t.slug
$$;
--> statement-breakpoint
create or replace function app.profile_form_question_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old_min jsonb;
  v_new_min jsonb;
  v_old_max jsonb;
  v_new_max jsonb;
begin
  -- A question nobody has answered is free to change in every way (the services still apply their own rules).
  if not exists (
    select 1
    from public.profile_form_answers a
    where a.tenant_id = old.tenant_id
      and a.question_id = old.id
  ) then
    return new;
  end if;

  -- PF001: the type is locked once the question has answers (D-587).
  if new.type is distinct from old.type then
    raise exception 'profile form question % has answers: its type cannot change', old.id
      using errcode = 'PF001';
  end if;

  -- PF002: an option that has answers can be neither removed nor relabelled (adding options is free).
  if exists (
    select 1
    from jsonb_array_elements(old.options) as o(opt)
    where exists (
            select 1
            from public.profile_form_answers a
            where a.tenant_id = old.tenant_id
              and a.question_id = old.id
              and (
                a.value ->> 'optionId' = o.opt ->> 'id'
                or (jsonb_typeof(a.value -> 'optionIds') = 'array'
                    and a.value -> 'optionIds' @> to_jsonb(o.opt ->> 'id'))
              )
          )
      and not exists (
            select 1
            from jsonb_array_elements(new.options) as n(opt)
            where n.opt ->> 'id' = o.opt ->> 'id'
              and n.opt ->> 'label' = o.opt ->> 'label'
          )
  ) then
    raise exception 'profile form question % has answers: an answered option cannot be removed or renamed', old.id
      using errcode = 'PF002';
  end if;

  -- PF003: "Outro" cannot be switched off while an "Outro" answer exists.
  if old.allow_other and not new.allow_other and exists (
    select 1
    from public.profile_form_answers a
    where a.tenant_id = old.tenant_id
      and a.question_id = old.id
      and a.value ->> 'otherText' is not null
  ) then
    raise exception 'profile form question % has answers: Outro cannot be turned off', old.id
      using errcode = 'PF003';
  end if;

  -- PF004: a private answer must never become public silently (the one-way ratchet toward private, PU-1).
  if not old.show_on_profile and new.show_on_profile then
    raise exception 'profile form question % has answers: it cannot become public', old.id
      using errcode = 'PF004';
  end if;

  -- PF005: a number or date limit may only widen. A bound that did not exist and now does is a narrowing too.
  if old.type = 'number' then
    v_old_min := old.limits -> 'min';
    v_new_min := new.limits -> 'min';
    v_old_max := old.limits -> 'max';
    v_new_max := new.limits -> 'max';
    if (jsonb_typeof(v_new_min) = 'number'
        and (jsonb_typeof(v_old_min) is distinct from 'number'
             or (v_new_min #>> '{}')::numeric > (v_old_min #>> '{}')::numeric))
       or (jsonb_typeof(v_new_max) = 'number'
        and (jsonb_typeof(v_old_max) is distinct from 'number'
             or (v_new_max #>> '{}')::numeric < (v_old_max #>> '{}')::numeric)) then
      raise exception 'profile form question % has answers: a number limit cannot narrow', old.id
        using errcode = 'PF005';
    end if;
  elsif old.type = 'date' then
    v_old_min := old.limits -> 'min';
    v_new_min := new.limits -> 'min';
    v_old_max := old.limits -> 'max';
    v_new_max := new.limits -> 'max';
    -- ISO days (YYYY-MM-DD) order the same as text.
    if (jsonb_typeof(v_new_min) = 'string'
        and (jsonb_typeof(v_old_min) is distinct from 'string'
             or (v_new_min #>> '{}') > (v_old_min #>> '{}')))
       or (jsonb_typeof(v_new_max) = 'string'
        and (jsonb_typeof(v_old_max) is distinct from 'string'
             or (v_new_max #>> '{}') < (v_old_max #>> '{}'))) then
      raise exception 'profile form question % has answers: a date limit cannot narrow', old.id
        using errcode = 'PF005';
    end if;
  end if;

  return new;
end
$$;
--> statement-breakpoint
create or replace trigger profile_form_questions_guard
  before update on public.profile_form_questions
  for each row execute function app.profile_form_question_guard();
--> statement-breakpoint
revoke all on function app.profile_form_missing(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function app.profile_form_missing_self() from public;
--> statement-breakpoint
revoke all on function app.membership_in_tenant_gate(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function app.memberships_of_user_gate(uuid) from public;
--> statement-breakpoint
revoke all on function app.profile_form_question_guard() from public;
--> statement-breakpoint
grant execute on function app.membership_in_tenant_gate(uuid, uuid) to api_user, service_role;
--> statement-breakpoint
grant execute on function app.memberships_of_user_gate(uuid) to api_user, service_role;
--> statement-breakpoint
grant execute on function app.profile_form_missing(uuid, uuid) to api_user, service_role;
--> statement-breakpoint
grant execute on function app.profile_form_missing_self() to authenticated, api_user, service_role;
