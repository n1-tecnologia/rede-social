-- profile_form_lock_active (Phase 12-06, PFORM-24 member half; D-587; T-12-16) —
-- the member's save locks the ACTIVE questions of its tenant `FOR SHARE` before it validates, so an admin's
-- type, option or visibility change and a member's answer never interleave. Custom migration (a function and
-- its grants; drizzle-kit cannot model them).
--
-- WHY A FUNCTION. The member lane runs as `authenticated` under RLS. `SELECT ... FOR SHARE` applies the
-- UPDATE policy's USING clause to the rows it would lock (only `admin_tenant` passes it), so from a member's
-- session the statement silently locks and returns ZERO rows (verified on the local stack). A SECURITY DEFINER
-- function owned by the table owner (RLS not forced) locks the rows regardless of the caller's role; the
-- tenant is taken from the session claims (`app.tenant_id()`), never from an argument, so the function can
-- only ever lock the caller's own tenant (T-12-14), and a null or unknown role claim gets nothing.
--
-- LOCK ORDER. Rows are locked in ONE canonical order, `position, created_at, id`, which is the order of the
-- member form and the order every multi-row admin write of the builder uses, so two sessions locking
-- overlapping sets of questions queue instead of deadlocking.
--
-- CONFLICTS. `FOR SHARE` conflicts with the `FOR NO KEY UPDATE` lock an `UPDATE` of a question takes, so an
-- admin edit waits for the member's save to commit and then runs the `profile_form_questions_guard` trigger
-- against the committed answer (PF001..PF005). It does not conflict with the `FOR KEY SHARE` an answer's
-- foreign key takes, nor with another member's `FOR SHARE`, so members never queue behind each other.
--
-- HARDENING. SECURITY DEFINER, `search_path = ''`, fully qualified names, VOLATILE (a locking read must be).
-- EXECUTE is revoked from PUBLIC and granted to the tenant lane and the two server roles, like
-- `app.profile_form_missing_self()`. Expand-only: one new function, no table or existing function touched.
-- The API revision that calls it needs this migration applied first (plan 18 release notes).

create or replace function app.profile_form_lock_active()
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
  revision integer
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
         q.revision
  from public.profile_form_questions q
  where q.tenant_id = app.tenant_id()
    and q.archived_at is null
    and app.tenant_role() in ('admin_tenant', 'support_tenant', 'member')
  order by q.position, q.created_at, q.id
  for share of q
$$;
--> statement-breakpoint
revoke all on function app.profile_form_lock_active() from public;
--> statement-breakpoint
grant execute on function app.profile_form_lock_active() to authenticated, api_user, service_role;
