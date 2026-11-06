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
