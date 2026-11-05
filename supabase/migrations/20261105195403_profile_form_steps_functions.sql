-- profile_form_steps_functions (Phase 12.1-06, PFORM-27, PFORM-30, PFORM-31, PFORM-33, PFORM-40; D-621, D-624, D-625,
-- D-631, D-632, D-636; T-12.1-04, T-12.1-05, T-12.1-15) — the SQL half of conditional questions and steps. Custom
-- migration (drizzle-kit cannot model functions or grants). It runs after `*_profile_form_steps_backfill.sql`, which
-- made `step_id` mandatory, and after the generated `20261105194320_profile_form_steps.sql`, which added the columns.
--
-- ── WHAT THIS FILE INSTALLS ─────────────────────────────────────────────────────────────────────────
--   * `app.profile_form_answer_tokens(jsonb)` — IMMUTABLE, the SQL twin of `answerTokens` in the contracts: a boolean
--     gives 'true' or 'false', an object with an `optionIds` array gives its string elements, an object with a string
--     `optionId` gives that one id, anything else (the "Outro" answer, text, numbers, null) gives an empty array.
--     The gate and the purge share it, so there is no per-type logic anywhere else.
--   * `app.profile_form_missing(uuid, uuid)` — `create or replace` with the SAME signature and attributes. Only the third
--     branch changes: a required, active question with no answer row is owed only when it has no condition OR its opener
--     has an answer row whose tokens overlap the condition's values. The two short circuits (module off, not a live
--     member) are byte-identical, so the `_self` and `_gate` twins, `reviewer.ts` and the bootstrap block pick the new
--     rule with no change. One function, one round trip, no recursion (an opener never carries a condition, D-622).
--     Cost: ONE extra unique-index probe `(tenant_id, membership_id, question_id)` per conditional required question,
--     at most 30 questions; a tenant with the module off still pays the one primary-key probe of the first branch.
--   * `app.profile_form_purge_closed` — SECURITY DEFINER; takes tenant and member from the session claims
--     (`app.tenant_id()`, `app.user_id()`, the `_self` pattern) and deletes the caller's OWN answers to every question
--     that has a condition whose opener answer is absent or does not overlap. It covers ACTIVE and ARCHIVED questions
--     alike (D-636): a member cannot see an archived question through row-level security, so a plain member-lane delete
--     would leave a stale answer that a later reactivation would expose. It accepts no id, so it cannot reach another
--     member's or another tenant's row (T-12.1-15).
--   * `app.profile_form_lock_active_v2` — a NEW function: the result row type of the old lock function cannot change under
--     `create or replace`, and dropping it would break the API revision still serving during the fan-out. It returns the old
--     eleven columns plus `step_id`, `condition_question_id` and `condition_values`, ordered and locked `for share of q`
--     exactly like the old one. The old function stays for one release; its drop is a later cleanup recorded in the release
--     notes of plan 19, never here.
--   * `app.profile_form_question_guard()` — replaced, same trigger. PF007 is evaluated FIRST, before the early return that
--     skips unanswered questions: an opener with ACTIVE dependents may not be archived, retyped, lose an option id that a
--     dependent's values reference, or gain a condition itself (D-622, D-632). PF001 to PF005 keep their exact text and
--     order; PF006 sits at the end of the answered branch: a condition may not be gained or changed once the question has
--     answers (D-625); removing it passes.
--
-- ── HARDENING ───────────────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER where the function reads across row policies, `search_path = ''` and fully qualified names everywhere,
-- EXECUTE revoked from PUBLIC (the default ACL of `public` hands it to anon/authenticated). The gate keeps its existing
-- grant (`api_user`, `service_role` only: it takes an arbitrary membership id and must not be callable by a session).
--
-- ── RELEASE ORDER ───────────────────────────────────────────────────────────────────────────────────
-- Expand-only and fan-out safe: new functions and `create or replace` of two functions whose signatures do not change;
-- nothing dropped, no answer rewritten, no begin, commit or concurrent index build and no reference to the platform schema
-- (the tenant-set guard enforces it). The API image that fans this out must be rebuilt (plan 19 notes it).

create or replace function app.profile_form_answer_tokens(p_value jsonb)
returns text[]
language sql immutable set search_path = '' as $$
  select case jsonb_typeof(p_value)
    when 'boolean' then array[p_value #>> '{}']
    when 'object' then case
      when jsonb_typeof(p_value -> 'optionIds') = 'array'
        then array(
          select e #>> '{}'
          from jsonb_array_elements(p_value -> 'optionIds') as t(e)
          where jsonb_typeof(e) = 'string'
        )
      when jsonb_typeof(p_value -> 'optionId') = 'string'
        then array[p_value ->> 'optionId']
      else '{}'::text[]
    end
    else '{}'::text[]
  end
$$;
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
    -- 3. active required questions the member has no answer row for and that the member can see (partial index, then
    --    unique-index probes): an unconditional question is always owed, a conditional one only while its opener's
    --    answer overlaps the condition (D-631)
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
        and (
          q.condition_question_id is null
          or exists (
            select 1
            from public.profile_form_answers o
            where o.tenant_id = q.tenant_id
              and o.membership_id = p_membership
              and o.question_id = q.condition_question_id
              and q.condition_values && app.profile_form_answer_tokens(o.value)
          )
        )
    )
  end
$$;
--> statement-breakpoint
create or replace function app.profile_form_lock_active_v2()
returns table (
  id uuid,
  type text,
  title text,
  help_text text,
  required boolean,
  show_on_profile boolean,
  allow_other boolean,
  options jsonb,
  limits jsonb,
  "position" integer,
  revision integer,
  step_id uuid,
  condition_question_id uuid,
  condition_values text[]
)
language sql volatile security definer set search_path = '' as $$
  select q.id,
         q.type,
         q.title,
         q.help_text,
         q.required,
         q.show_on_profile,
         q.allow_other,
         q.options,
         q.limits,
         q.position,
         q.revision,
         q.step_id,
         q.condition_question_id,
         q.condition_values
  from public.profile_form_questions q
  where q.tenant_id = app.tenant_id()
    and q.archived_at is null
    and app.tenant_role() in ('admin_tenant', 'support_tenant', 'member')
  order by q.position, q.created_at, q.id
  for share of q
$$;
--> statement-breakpoint
create or replace function app.profile_form_purge_closed()
returns table (question_id uuid)
language sql volatile security definer set search_path = '' as $$
  delete from public.profile_form_answers a
  using public.profile_form_questions q, public.memberships m
  where m.tenant_id = app.tenant_id()
    and m.user_id = app.user_id()
    and m.deleted_at is null
    and a.tenant_id = m.tenant_id
    and a.membership_id = m.id
    and q.tenant_id = a.tenant_id
    and q.id = a.question_id
    and q.condition_question_id is not null
    and not exists (
      select 1
      from public.profile_form_answers o
      where o.tenant_id = a.tenant_id
        and o.membership_id = a.membership_id
        and o.question_id = q.condition_question_id
        and q.condition_values && app.profile_form_answer_tokens(o.value)
    )
  returning a.question_id
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
  -- PF007 (D-622, D-632): an opener with ACTIVE dependents may not be archived, retyped, lose an option id that a
  -- dependent's values reference, or gain a condition itself. It is independent of answers, so it runs before the
  -- early return below.
  if exists (
    select 1
    from public.profile_form_questions d
    where d.tenant_id = old.tenant_id
      and d.condition_question_id = old.id
      and d.archived_at is null
  ) and (
    (old.archived_at is null and new.archived_at is not null)
    or new.type is distinct from old.type
    or (new.condition_question_id is not null
        and old.condition_question_id is distinct from new.condition_question_id)
    or exists (
      select 1
      from jsonb_array_elements(old.options) as o(opt)
      where exists (
              select 1
              from public.profile_form_questions d
              where d.tenant_id = old.tenant_id
                and d.condition_question_id = old.id
                and d.archived_at is null
                and d.condition_values @> array[o.opt ->> 'id']
            )
        and not exists (
              select 1
              from jsonb_array_elements(new.options) as n(opt)
              where n.opt ->> 'id' = o.opt ->> 'id'
            )
    )
  ) then
    raise exception 'profile form question % has active dependents: it cannot be archived, retyped, lose a referenced option or gain a condition', old.id
      using errcode = 'PF007';
  end if;

  -- A question nobody has answered is free to change in every other way (the services still apply their own rules).
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

  -- PF006: a condition may not be gained or changed once the question has answers (D-625); removing it passes.
  if new.condition_question_id is not null
     and (old.condition_question_id is distinct from new.condition_question_id
          or old.condition_values is distinct from new.condition_values) then
    raise exception 'profile form question % has answers: its condition cannot be added or changed', old.id
      using errcode = 'PF006';
  end if;

  return new;
end
$$;
--> statement-breakpoint
revoke all on function app.profile_form_answer_tokens(jsonb) from public;
--> statement-breakpoint
revoke all on function app.profile_form_missing(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function app.profile_form_question_guard() from public;
--> statement-breakpoint
revoke all on function app.profile_form_purge_closed() from public;
--> statement-breakpoint
revoke all on function app.profile_form_lock_active_v2() from public;
--> statement-breakpoint
grant execute on function app.profile_form_answer_tokens(jsonb) to authenticated, api_user, service_role;
--> statement-breakpoint
grant execute on function app.profile_form_purge_closed() to authenticated, api_user, service_role;
--> statement-breakpoint
grant execute on function app.profile_form_lock_active_v2() to authenticated, api_user, service_role;
