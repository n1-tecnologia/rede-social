-- profile_form_branches_functions (Phase 12.2-06, PFORM-45, PFORM-46, PFORM-47, PFORM-48, PFORM-53, PFORM-55; D-640, D-641,
-- D-644, D-645, D-646; T-12.2-02, T-12.2-06, T-12.2-07, T-12.2-08, T-12.2-10, T-12.2-11, T-12.2-12, T-12.2-18) — the SQL half of
-- the branches of the profile form. Custom migration (drizzle-kit cannot model functions, triggers, grants or DEFERRABLE keys).
-- It runs after the generated `20261106174037_profile_form_branches.sql`, which created the `profile_form_branches` table and
-- added the nullable `branch_id` to the questions, and after `20261105195403_profile_form_steps_functions.sql`, whose gate,
-- purge and guard it replaces.
--
-- ── WHAT THIS FILE INSTALLS, IN THIS ORDER (the order is the point of the file) ────────────────────────
--   1. The pair of composite keys, `profile_form_branches_opener_fk` and `profile_form_questions_branch_fk`, hand written
--      and left out of the Drizzle schema and of the snapshot, exactly as `events` and `event_secrets` did: drizzle-kit
--      cannot express DEFERRABLE, and the tenant move needs the two tables plannable as ONE group. Both are NO ACTION and
--      deferrable initially immediate, so an ordinary API write is checked at the end of the statement as in 12.1; only
--      the tenant move opts into deferral with `set constraints all deferred`. A dangling branch id is impossible.
--   2. `app.profile_form_lock_active_v3()` and `app.profile_form_lock_branches()`, both NEW: a return row type cannot
--      change under `create or replace`, and dropping the v2 function would break the API revision still serving during
--      the fan-out. v3 is the v2 column list with `branch_id` in place of the two condition columns. The branch lock
--      returns the branch row WITHOUT its name (a member never reads it) and locks `for share of b`.
--   3. `app.profile_form_missing(uuid, uuid)` (the gate) — `create or replace` with the SAME signature and attributes. The
--      two short circuits (module off, not a live member) are byte-identical to 12.1. Only the third branch changes: a
--      required, active question with no answer row is owed when it has no branch OR every branch on its chain is open
--      for the member. The chain is a fixed join of exactly `PROFILE_FORM_LIMITS.branchDepth` levels (no recursion, no
--      row cap): the question is left-joined to its branch, the branch's opener, the opener's branch, and so on up.
--      A branch is open when the member holds an answer to the branch's opener whose tokens overlap its opening values.
--      The `_self` and `_gate` twins, the reviewer and the bootstrap block call the same function and pick the rule
--      up with no new round trip. A module-off tenant still pays the one primary-key probe of the first branch.
--   4. `app.profile_form_purge_closed()` — `create or replace`, same signature, claims scoped (`app.tenant_id()`,
--      `app.user_id()`, no argument). It deletes the caller's OWN answers to every question, active or archived, that
--      sits in a branch whose chain is not entirely open, and returns the deleted question ids. It reads NO archive
--      state of a question or of a branch: an archived block keeps its answers (D-588), only a really closed chain
--      erases them. Closing a branch therefore also erases everything below it in one statement.
--   5. The conversion: one `do` block that turns every 12.1 per-question condition into a branch, in the same file and
--      transaction that swaps the gate. Lossless, idempotent and a no-op on a project with no legacy condition. It must
--      run BEFORE the guards below: the new question guard would refuse pointing an answered question at a branch.
--   6. `app.profile_form_question_guard()` — replaced restating its whole body. PF007 first and re-targeted to branches,
--      then the early return, PF001 to PF005 with unchanged text, and PF006 at the end of the answered branch.
--   7. `app.profile_form_branch_guard()` and its BEFORE UPDATE trigger on the branches (PF006 on the opener or the set of
--      opening values once any question of the branch has an answer).
--   8. `app.profile_form_tree_guard()` and its two AFTER row triggers: PF008 (a chain deeper than the limit, or a cycle)
--      and PF009 (a question shown on the profile under an opener that is not, WR-06). Installed after the conversion so
--      a legacy row cannot abort the fan-out.
--   9. `app.profile_form_legacy_condition_guard()` and its trigger, installed LAST: PF010 refuses a write of the retired
--      condition pair, so a previous API revision that writes one during the fan-out fails loudly instead of being
--      ignored by the new gate. The conversion above is the last reader of that pair.
--  10. The grants, and `revoke truncate` on the branches table (TRUNCATE is not subject to row-level security and Supabase's
--      default privileges hand it to every lane, the lesson of the Phase 12 and 12.1 files).
--
-- The v2 lock function and the legacy condition columns stay one release; a later cleanup migration drops them, never here.
--
-- ── DEPTH IS A LITERAL HERE, AND A TEST PINS IT ─────────────────────────────────────────────────────
-- A trigger cannot import the TypeScript constant the way a Drizzle CHECK does. The gate unrolls three levels (b1, b2, b3)
-- and the depth test of PF008 four (b1 to b4, one more than the limit). `packages/core/tests/profile-form-branch-depth.test.ts`
-- parses this file and fails when either number leaves `PROFILE_FORM_LIMITS.branchDepth`, so raising the limit is a new
-- migration plus a failing test that says so.
--
-- ── HARDENING ───────────────────────────────────────────────────────────────────────────────────────
-- Every function sets `search_path = ''` and names every object fully qualified. The functions that read across row policies
-- are SECURITY DEFINER and take the tenant and the member only from the session claims (or from the tenant argument of the
-- gate, which is callable by `api_user` and `service_role` only). EXECUTE is revoked from PUBLIC on every function here.
--
-- ── RELEASE ORDER ───────────────────────────────────────────────────────────────────────────────────
-- Expand-only and fan-out safe: new objects and `create or replace` of functions whose signatures do not change; nothing
-- dropped, no answer rewritten, no transaction-control statement, no concurrent index build and no reference to the
-- central registry (the tenant-set guard enforces it). The API image that fans this out must be rebuilt (plan 21 notes it).
-- Nothing in this file has been applied to any database; publication is the owner's release step.

alter table "profile_form_branches" add constraint "profile_form_branches_opener_fk" foreign key ("tenant_id","opener_question_id") references "public"."profile_form_questions"("tenant_id","id") on delete no action on update no action DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
alter table "profile_form_questions" add constraint "profile_form_questions_branch_fk" foreign key ("tenant_id","branch_id") references "public"."profile_form_branches"("tenant_id","id") on delete no action on update no action DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
create or replace function app.profile_form_lock_active_v3()
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
  branch_id uuid
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
         q.branch_id
  from public.profile_form_questions q
  where q.tenant_id = app.tenant_id()
    and q.archived_at is null
    and app.tenant_role() in ('admin_tenant', 'support_tenant', 'member')
  order by q.position, q.created_at, q.id
  for share of q
$$;
--> statement-breakpoint
create or replace function app.profile_form_lock_branches()
returns table (
  id uuid,
  opener_question_id uuid,
  open_values text[],
  revision integer,
  archived_at timestamptz
)
language sql volatile security definer set search_path = '' as $$
  select b.id,
         b.opener_question_id,
         b.open_values,
         b.revision,
         b.archived_at
  from public.profile_form_branches b
  where b.tenant_id = app.tenant_id()
    and app.tenant_role() in ('admin_tenant', 'support_tenant', 'member')
  order by b.created_at, b.id
  for share of b
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
    -- 3. active required questions the member has no answer row for and that the member can see: an unconditional
    --    question is always owed, a question in a branch only while EVERY branch on its chain is open (D-641, D-644).
    --    The chain is a fixed join of three levels (the depth limit, kept by a trigger), unique-index probes only.
    --    A level that is not on the chain has a null branch and counts as open; a dangling id cannot exist.
    else (
      select count(*)::int
      from public.profile_form_questions q
      left join public.profile_form_branches b1
        on b1.tenant_id = q.tenant_id and b1.id = q.branch_id
      left join public.profile_form_questions o1
        on o1.tenant_id = b1.tenant_id and o1.id = b1.opener_question_id
      left join public.profile_form_branches b2
        on b2.tenant_id = o1.tenant_id and b2.id = o1.branch_id
      left join public.profile_form_questions o2
        on o2.tenant_id = b2.tenant_id and o2.id = b2.opener_question_id
      left join public.profile_form_branches b3
        on b3.tenant_id = o2.tenant_id and b3.id = o2.branch_id
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
          q.branch_id is null
          or (
            exists (
              select 1
              from public.profile_form_answers x1
              where x1.tenant_id = q.tenant_id
                and x1.membership_id = p_membership
                and x1.question_id = b1.opener_question_id
                and b1.open_values && app.profile_form_answer_tokens(x1.value)
            )
            and (
              b2.id is null
              or exists (
                select 1
                from public.profile_form_answers x2
                where x2.tenant_id = q.tenant_id
                  and x2.membership_id = p_membership
                  and x2.question_id = b2.opener_question_id
                  and b2.open_values && app.profile_form_answer_tokens(x2.value)
              )
            )
            and (
              b3.id is null
              or exists (
                select 1
                from public.profile_form_answers x3
                where x3.tenant_id = q.tenant_id
                  and x3.membership_id = p_membership
                  and x3.question_id = b3.opener_question_id
                  and b3.open_values && app.profile_form_answer_tokens(x3.value)
              )
            )
          )
        )
    )
  end
$$;
--> statement-breakpoint
create or replace function app.profile_form_purge_closed()
returns table (question_id uuid)
language sql volatile security definer set search_path = '' as $$
  delete from public.profile_form_answers a
  using public.memberships m, public.profile_form_questions q
  left join public.profile_form_branches b1
    on b1.tenant_id = q.tenant_id and b1.id = q.branch_id
  left join public.profile_form_questions o1
    on o1.tenant_id = b1.tenant_id and o1.id = b1.opener_question_id
  left join public.profile_form_branches b2
    on b2.tenant_id = o1.tenant_id and b2.id = o1.branch_id
  left join public.profile_form_questions o2
    on o2.tenant_id = b2.tenant_id and o2.id = b2.opener_question_id
  left join public.profile_form_branches b3
    on b3.tenant_id = o2.tenant_id and b3.id = o2.branch_id
  where m.tenant_id = app.tenant_id()
    and m.user_id = app.user_id()
    and m.deleted_at is null
    and a.tenant_id = m.tenant_id
    and a.membership_id = m.id
    and q.tenant_id = a.tenant_id
    and q.id = a.question_id
    and q.branch_id is not null
    and not (
      exists (
        select 1
        from public.profile_form_answers x1
        where x1.tenant_id = a.tenant_id
          and x1.membership_id = a.membership_id
          and x1.question_id = b1.opener_question_id
          and b1.open_values && app.profile_form_answer_tokens(x1.value)
      )
      and (
        b2.id is null
        or exists (
          select 1
          from public.profile_form_answers x2
          where x2.tenant_id = a.tenant_id
            and x2.membership_id = a.membership_id
            and x2.question_id = b2.opener_question_id
            and b2.open_values && app.profile_form_answer_tokens(x2.value)
        )
      )
      and (
        b3.id is null
        or exists (
          select 1
          from public.profile_form_answers x3
          where x3.tenant_id = a.tenant_id
            and x3.membership_id = a.membership_id
            and x3.question_id = b3.opener_question_id
            and b3.open_values && app.profile_form_answer_tokens(x3.value)
        )
      )
    )
  returning a.question_id
$$;
--> statement-breakpoint
-- ── THE CONVERSION OF ANY 12.1 PER-QUESTION CONDITION INTO A BRANCH ────────────────────────────────
-- Production holds no such row today (the module is off per tenant), so this block normally writes nothing; it exists so
-- that a project where a form WAS built with conditions keeps its behaviour the moment the gate above starts reading
-- branches. Per tenant that holds a legacy condition not yet pointed at a branch:
--   a. the same per-tenant advisory lock key as `adminLock` (`profile_form:<tenant>`), so the block serialises with a
--      concurrent admin write and with a second fan-out run of this file on the same project;
--   b. the privacy-safe direction first: an ACTIVE legacy dependent that shows on the profile while its opener does not is
--      switched to private, so the PF009 trigger below never meets a legacy row (the owner's read-only hosted check, query
--      D, tells beforehand whether any such row exists). PF004 guards only the private to public direction, so this passes
--      the 12.1 question guard that is still installed here;
--   c. one branch per distinct (tenant, opener, sorted values), with no name, for every question of the tenant that has a
--      condition and no branch yet, archived ones included (they keep their condition for a later reactivation);
--   d. every such question, archived ones included, is pointed at the branch with its tenant, opener and sorted values.
-- The legacy columns are NOT cleared (strictly expand-only), and neither `revision` nor `updated_at` is touched. A second
-- run finds no row with a condition and no branch and writes nothing; a project with no legacy condition, or where the
-- module was never enabled, is untouched. The 12.1 order (the opener always before its dependent) is already a valid tree
-- order, so no layout rewrite happens here; the next layout write normalises the stored positions.
do $$
declare
  t uuid;
begin
  for t in
    select distinct q.tenant_id
      from public.profile_form_questions q
     where q.condition_question_id is not null
       and q.branch_id is null
     order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('profile_form:' || t::text, 0));

    update public.profile_form_questions d
       set show_on_profile = false
      from public.profile_form_questions o
     where d.tenant_id = t
       and d.archived_at is null
       and d.show_on_profile
       and d.branch_id is null
       and d.condition_question_id is not null
       and o.tenant_id = d.tenant_id
       and o.id = d.condition_question_id
       and not o.show_on_profile;

    insert into public.profile_form_branches (tenant_id, opener_question_id, open_values)
    select distinct q.tenant_id,
           q.condition_question_id,
           array(select v from unnest(q.condition_values) v order by v)
      from public.profile_form_questions q
     where q.tenant_id = t
       and q.condition_question_id is not null
       and q.branch_id is null;

    update public.profile_form_questions q
       set branch_id = b.id
      from public.profile_form_branches b
     where q.tenant_id = t
       and q.branch_id is null
       and q.condition_question_id is not null
       and b.tenant_id = q.tenant_id
       and b.opener_question_id = q.condition_question_id
       and b.open_values = array(select v from unnest(q.condition_values) v order by v);
  end loop;
end
$$;
--> statement-breakpoint
-- ── THE QUESTION GUARD, RESTATED (the BEFORE UPDATE trigger `profile_form_questions_guard` of 12.1 keeps calling it) ──
-- PF007 first, re-targeted from the retired per-question condition to the branches: an opener that has an ACTIVE branch may
-- not be archived, retyped or lose an option id that the branch's opening values reference. The 12.1 clause "or gain a
-- condition itself" is deleted on purpose: an opener may now sit inside a branch. PF007 does not depend on answers, so it
-- runs before the early return. PF001 to PF005 keep their exact text and order. PF006 sits at the end of the answered
-- branch: a question with answers may not enter or change a branch (D-646); leaving one passes, so "Desfazer ramo" works.
create or replace function app.profile_form_question_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old_min jsonb;
  v_new_min jsonb;
  v_old_max jsonb;
  v_new_max jsonb;
begin
  -- PF007 (D-632, D-646): an opener with an ACTIVE branch may not be archived, retyped or lose an option id that the
  -- branch's opening values reference. It is independent of answers, so it runs before the early return below.
  if exists (
    select 1
    from public.profile_form_branches b
    where b.tenant_id = old.tenant_id
      and b.opener_question_id = old.id
      and b.archived_at is null
  ) and (
    (old.archived_at is null and new.archived_at is not null)
    or new.type is distinct from old.type
    or exists (
      select 1
      from jsonb_array_elements(old.options) as o(opt)
      where exists (
              select 1
              from public.profile_form_branches b
              where b.tenant_id = old.tenant_id
                and b.opener_question_id = old.id
                and b.archived_at is null
                and b.open_values @> array[o.opt ->> 'id']
            )
        and not exists (
              select 1
              from jsonb_array_elements(new.options) as n(opt)
              where n.opt ->> 'id' = o.opt ->> 'id'
            )
    )
  ) then
    raise exception 'profile form question % has active branches: it cannot be archived, retyped or lose a referenced option', old.id
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

  -- PF006: a question with answers may not enter a branch or change its branch (D-646). Leaving a branch passes: the
  -- service forbids a single answered question leaving one, but "Desfazer ramo" (undo) needs the trigger to let it go.
  if new.branch_id is not null
     and new.branch_id is distinct from old.branch_id then
    raise exception 'profile form question % has answers: it cannot enter or change branch', old.id
      using errcode = 'PF006';
  end if;

  return new;
end
$$;
--> statement-breakpoint
-- ── THE BRANCH GUARD (D-646) ────────────────────────────────────────────────────────────────────────
-- Once any question of the branch, ACTIVE OR ARCHIVED, has an answer, the opener and the SET of opening values are frozen
-- (PF006): changing them would reinterpret stored answers. A reordered or repeated value list is the same set. A name
-- change, an archive and a revision bump pass. The BEFORE UPDATE row trigger runs after the row lock of the update, so a
-- member save that holds the branch `for share` (lock_branches) and an admin edit cannot both commit unseen.
create or replace function app.profile_form_branch_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.opener_question_id is distinct from old.opener_question_id
      or not (old.open_values @> new.open_values and new.open_values @> old.open_values))
     and exists (
       select 1
       from public.profile_form_questions q
       join public.profile_form_answers a
         on a.tenant_id = q.tenant_id and a.question_id = q.id
       where q.tenant_id = old.tenant_id
         and q.branch_id = old.id
     ) then
    raise exception 'profile form branch % has answers: its opener and opening values cannot change', old.id
      using errcode = 'PF006';
  end if;

  return new;
end
$$;
--> statement-breakpoint
create trigger profile_form_branches_guard
  before update on public.profile_form_branches
  for each row execute function app.profile_form_branch_guard();
--> statement-breakpoint
-- ── THE TREE GUARD (D-644, T-12.2-07, T-12.2-02) ────────────────────────────────────────────────────
-- Whole-tenant, so no subtree logic and no per-row reasoning: a tenant holds at most 30 active questions and 15 active
-- branches. Two tests, the depth first.
--   PF008: the tenant holds a chain of more than the depth limit of branches. The join below is `branch -> its opener ->
--   that opener's branch -> ...` one level past the limit; a cycle of any length also satisfies it, so one test refuses
--   both. An ARCHIVED branch still counts: it keeps its chain for a reactivation.
--   PF009 (WR-06): an ACTIVE question that shows on the profile has, anywhere on its chain, an opener that does not. The
--   service refuses it first (plan 09); this is the database backstop. Installed after the conversion above, so a legacy row
--   cannot abort the fan-out; the triggers below fire on the columns that can break the rule and never on `writeLayout`
--   (which sets only the position, the step and the revision).
create or replace function app.profile_form_tree_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1
    from public.profile_form_branches b1
    join public.profile_form_questions o1
      on o1.tenant_id = b1.tenant_id and o1.id = b1.opener_question_id
    join public.profile_form_branches b2
      on b2.tenant_id = o1.tenant_id and b2.id = o1.branch_id
    join public.profile_form_questions o2
      on o2.tenant_id = b2.tenant_id and o2.id = b2.opener_question_id
    join public.profile_form_branches b3
      on b3.tenant_id = o2.tenant_id and b3.id = o2.branch_id
    join public.profile_form_questions o3
      on o3.tenant_id = b3.tenant_id and o3.id = b3.opener_question_id
    join public.profile_form_branches b4
      on b4.tenant_id = o3.tenant_id and b4.id = o3.branch_id
    where b1.tenant_id = new.tenant_id
  ) then
    raise exception 'profile form of tenant % holds a chain of branches deeper than the limit, or a cycle', new.tenant_id
      using errcode = 'PF008';
  end if;

  if exists (
    select 1
    from public.profile_form_questions q
    join public.profile_form_branches b1
      on b1.tenant_id = q.tenant_id and b1.id = q.branch_id
    join public.profile_form_questions o1
      on o1.tenant_id = b1.tenant_id and o1.id = b1.opener_question_id
    left join public.profile_form_branches b2
      on b2.tenant_id = o1.tenant_id and b2.id = o1.branch_id
    left join public.profile_form_questions o2
      on o2.tenant_id = b2.tenant_id and o2.id = b2.opener_question_id
    left join public.profile_form_branches b3
      on b3.tenant_id = o2.tenant_id and b3.id = o2.branch_id
    left join public.profile_form_questions o3
      on o3.tenant_id = b3.tenant_id and o3.id = b3.opener_question_id
    where q.tenant_id = new.tenant_id
      and q.show_on_profile
      and q.archived_at is null
      and (
        not o1.show_on_profile
        or o2.show_on_profile is false
        or o3.show_on_profile is false
      )
  ) then
    raise exception 'profile form of tenant % shows a question on the profile under an opener that is not shown', new.tenant_id
      using errcode = 'PF009';
  end if;

  return new;
end
$$;
--> statement-breakpoint
create trigger profile_form_branches_tree_guard
  after insert or update of opener_question_id on public.profile_form_branches
  for each row execute function app.profile_form_tree_guard();
--> statement-breakpoint
create trigger profile_form_questions_tree_guard
  after insert or update of branch_id, show_on_profile, archived_at on public.profile_form_questions
  for each row execute function app.profile_form_tree_guard();
--> statement-breakpoint
-- ── THE LEGACY GUARD, INSTALLED LAST (T-12.2-08) ────────────────────────────────────────────────────
-- The 12.1 condition pair is retired for one release: nothing may write it any more. A previous API revision that still
-- writes a condition during the fan-out fails loudly (PF010) instead of being ignored by the new gate. Installed after the
-- conversion, which was the last reader of the pair. A row that already carries a condition and is updated without
-- touching the pair passes, and so does clearing it. This function reads no table, so it needs no elevated rights.
create or replace function app.profile_form_legacy_condition_guard()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.condition_question_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.condition_question_id is not distinct from new.condition_question_id
       and old.condition_values is not distinct from new.condition_values then
      return new;
    end if;
  end if;

  raise exception 'profile form question % cannot carry a condition any more: use a branch', new.id
    using errcode = 'PF010';
end
$$;
--> statement-breakpoint
create trigger profile_form_questions_legacy_condition_guard
  before insert or update of condition_question_id, condition_values on public.profile_form_questions
  for each row execute function app.profile_form_legacy_condition_guard();
--> statement-breakpoint
-- ── GRANTS ──────────────────────────────────────────────────────────────────────────────────────────
-- EXECUTE is revoked from PUBLIC on every function of the file (the default ACL of the public schema hands it to anon and
-- authenticated). The gate keeps its existing grant (`api_user`, `service_role` only: it takes an arbitrary membership id and
-- must not be callable by a session). The purge and the two lock functions are granted exactly like their 12.1 twins.
revoke all on function app.profile_form_lock_active_v3() from public;
--> statement-breakpoint
revoke all on function app.profile_form_lock_branches() from public;
--> statement-breakpoint
revoke all on function app.profile_form_missing(uuid, uuid) from public;
--> statement-breakpoint
revoke all on function app.profile_form_purge_closed() from public;
--> statement-breakpoint
revoke all on function app.profile_form_question_guard() from public;
--> statement-breakpoint
revoke all on function app.profile_form_branch_guard() from public;
--> statement-breakpoint
revoke all on function app.profile_form_tree_guard() from public;
--> statement-breakpoint
revoke all on function app.profile_form_legacy_condition_guard() from public;
--> statement-breakpoint
grant execute on function app.profile_form_lock_active_v3() to authenticated, api_user, service_role;
--> statement-breakpoint
grant execute on function app.profile_form_lock_branches() to authenticated, api_user, service_role;
--> statement-breakpoint
grant execute on function app.profile_form_purge_closed() to authenticated, api_user, service_role;
--> statement-breakpoint
revoke truncate on public.profile_form_branches from authenticated;
