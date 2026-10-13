-- store_course_gate (08.3-01, COURSE-08, D-404, D-405; RESEARCH Pattern 3, Code Example 2) — the
-- store's half of the COURSE and LIVE gate seam: the BODIES of the four kernel functions declared
-- as stubs by `*_course_gate_seam.sql`, replaced with `create or replace` and the SAME signatures,
-- so `course_lessons_course_gate` and every later consumer keep calling them by name. Hand-written
-- (`--custom`), applied AFTER the generated `*_courses.sql` that created `course_products` and
-- `course_live_products` (SQL-language bodies are validated at creation) and after
-- `*_courses_functions.sql` (the FKs to `store_products`).
--
--   - `app.course_locked_ids_for(p_user)`: the courses of THIS tenant linked to at least one
--     product, minus those where `p_user` holds an ACTIVE entitlement to ANY linked product; '{}'
--     when the tenant's `store` row is missing or disabled (STORE-01, D-405: links stay dormant)
--     and '{}' when the tenant's `courses` row is missing or disabled (COURSE-01, P02: with the
--     module off the gate is inert, nothing it reads is reachable); '{}' when `p_user` is staff of
--     the tenant by their `memberships` row (the worker's explicit form);
--   - `app.course_locked_ids()`: the lane form. Staff by CLAIM: only an `admin_tenant` or
--     `support_tenant` claim answers '{}'. A null or unknown `tenant_role` claim takes the MEMBER
--     branch, through the `_for` form with `app.user_id()` (fails closed, T-08.3-04: the member
--     branch never consults `memberships` for staff);
--   - `app.live_locked_ids_for(p_user)` and `app.live_locked_ids()`: the same two rules over
--     `course_live_products`.
--   The answer is a SET (`array_agg(distinct …)`); no caller relies on its order. An archived
--   product still locks and its holders keep access (the store's Assumption A4): no product status
--   is read here. A course with NO link never appears in the set: it is open to every member.
--
-- Hardening (the T-06-29 posture): every function is SECURITY DEFINER with `search_path = ''` and
-- fully qualified names. The owner bypasses RLS, so EVERY statement pins `tenant_id =
-- app.tenant_id()` itself (and the entitlement's `user_id` to the user asked about): a course,
-- link or entitlement of another tenant matches nothing. EXECUTE is revoked from PUBLIC and granted
-- to `authenticated` only. No single-row LIMIT anywhere (pgTAP 040's allow-list).

create or replace function app.course_locked_ids_for(p_user uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct l.course_id), '{}'::uuid[])
    from public.course_products l
   where l.tenant_id = app.tenant_id()
     and exists (select 1 from public.tenant_modules tm
                  where tm.tenant_id = l.tenant_id and tm.module_key = 'store' and tm.enabled)
     and exists (select 1 from public.tenant_modules tm
                  where tm.tenant_id = l.tenant_id and tm.module_key = 'courses' and tm.enabled)
     and not exists (select 1 from public.memberships m
                      where m.tenant_id = l.tenant_id and m.user_id = p_user
                        and m.role in ('admin_tenant', 'support_tenant') and m.deleted_at is null)
     and not exists (
       select 1
         from public.course_products l2
         join public.store_entitlements e
           on e.tenant_id = l2.tenant_id and e.product_id = l2.product_id
        where l2.tenant_id = l.tenant_id and l2.course_id = l.course_id
          and e.user_id = p_user and e.status = 'active')
$$;
--> statement-breakpoint
revoke all on function app.course_locked_ids_for(uuid) from public;--> statement-breakpoint
grant execute on function app.course_locked_ids_for(uuid) to authenticated;--> statement-breakpoint

create or replace function app.course_locked_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case
    when app.tenant_role() in ('admin_tenant', 'support_tenant') then '{}'::uuid[]
    else (
      select coalesce(array_agg(distinct l.course_id), '{}'::uuid[])
        from public.course_products l
       where l.tenant_id = app.tenant_id()
         and exists (select 1 from public.tenant_modules tm
                      where tm.tenant_id = l.tenant_id and tm.module_key = 'store' and tm.enabled)
         and exists (select 1 from public.tenant_modules tm
                      where tm.tenant_id = l.tenant_id and tm.module_key = 'courses' and tm.enabled)
         and not exists (
           select 1
             from public.course_products l2
             join public.store_entitlements e
               on e.tenant_id = l2.tenant_id and e.product_id = l2.product_id
            where l2.tenant_id = l.tenant_id and l2.course_id = l.course_id
              and e.user_id = app.user_id() and e.status = 'active'))
  end
$$;
--> statement-breakpoint
revoke all on function app.course_locked_ids() from public;--> statement-breakpoint
grant execute on function app.course_locked_ids() to authenticated;--> statement-breakpoint

create or replace function app.live_locked_ids_for(p_user uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct l.live_id), '{}'::uuid[])
    from public.course_live_products l
   where l.tenant_id = app.tenant_id()
     and exists (select 1 from public.tenant_modules tm
                  where tm.tenant_id = l.tenant_id and tm.module_key = 'store' and tm.enabled)
     and exists (select 1 from public.tenant_modules tm
                  where tm.tenant_id = l.tenant_id and tm.module_key = 'courses' and tm.enabled)
     and not exists (select 1 from public.memberships m
                      where m.tenant_id = l.tenant_id and m.user_id = p_user
                        and m.role in ('admin_tenant', 'support_tenant') and m.deleted_at is null)
     and not exists (
       select 1
         from public.course_live_products l2
         join public.store_entitlements e
           on e.tenant_id = l2.tenant_id and e.product_id = l2.product_id
        where l2.tenant_id = l.tenant_id and l2.live_id = l.live_id
          and e.user_id = p_user and e.status = 'active')
$$;
--> statement-breakpoint
revoke all on function app.live_locked_ids_for(uuid) from public;--> statement-breakpoint
grant execute on function app.live_locked_ids_for(uuid) to authenticated;--> statement-breakpoint

create or replace function app.live_locked_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case
    when app.tenant_role() in ('admin_tenant', 'support_tenant') then '{}'::uuid[]
    else (
      select coalesce(array_agg(distinct l.live_id), '{}'::uuid[])
        from public.course_live_products l
       where l.tenant_id = app.tenant_id()
         and exists (select 1 from public.tenant_modules tm
                      where tm.tenant_id = l.tenant_id and tm.module_key = 'store' and tm.enabled)
         and exists (select 1 from public.tenant_modules tm
                      where tm.tenant_id = l.tenant_id and tm.module_key = 'courses' and tm.enabled)
         and not exists (
           select 1
             from public.course_live_products l2
             join public.store_entitlements e
               on e.tenant_id = l2.tenant_id and e.product_id = l2.product_id
            where l2.tenant_id = l.tenant_id and l2.live_id = l.live_id
              and e.user_id = app.user_id() and e.status = 'active'))
  end
$$;
--> statement-breakpoint
revoke all on function app.live_locked_ids() from public;--> statement-breakpoint
grant execute on function app.live_locked_ids() to authenticated;
