-- store_course_links_functions (08.4-01, SC 4, COURSE-08, COURSE-11; D-418, D-405; RESEARCH
-- Pattern 2, Pitfalls 1-2) — the store's half of the kernel COURSE and LIVE gate seam, moved onto the
-- store-owned link tables created by `*_store_course_links.sql`. Hand-written (`--custom`), in this
-- order (EP-15: the gate is correct at every statement boundary, whatever the CLI's transaction
-- wrapping):
--
--   1. `store_product_courses_course_fk` → `courses(id)` and `store_product_lives_live_fk` →
--      `course_lives(id)`, both `on delete cascade` (a removed course or live drops its links). Hand
--      SQL so the store package never imports the courses schema (MOD-02; the
--      `store_product_communities_community_fk` precedent).
--   2. `revoke truncate … from authenticated` on both tables: TRUNCATE is not subject to RLS, and a
--      lane that could empty the links would open every paid course and live (the
--      `*_store_admin_write_truncate.sql` posture, T-08.4-03).
--   3. THE CARRY-OVER: every 08.3 link row (`course_products`, `course_live_products`) is copied into
--      the store tables preserving `created_at` (`on conflict … do nothing`), then a guard raises
--      `store_course_links: … link sets differ after the carry-over` on any set difference in either
--      direction.
--   4. ONLY THEN the four bodies `app.course_locked_ids_for(uuid)`, `app.course_locked_ids()`,
--      `app.live_locked_ids_for(uuid)` and `app.live_locked_ids()` are replaced with
--      `create or replace`, the SAME signatures and the 08.3 rule (`*_store_course_gate.sql`)
--      verbatim except the table names, each followed by its revoke/grant pair. The kernel seam
--      file, its stub migration and the two restrictive policies are unchanged.
--
-- Why the copy and the swap share ONE file: between them the gate would read an empty table and
-- open every paid course. An apply interrupted before the swap leaves the bodies reading the
-- still-populated 08.3 tables; one interrupted mid-swap leaves each function reading a fully
-- populated table. Why the DROP of the 08.3 tables is a LATER file: a `language sql` body is not
-- tracked as a dependency, so `drop table` would succeed while a body still named the table and the
-- gate would fail at its next call (RESEARCH probe).
--
-- Hardening (the T-06-29 posture): every function is SECURITY DEFINER with `search_path = ''` and
-- fully qualified names. The owner bypasses RLS, so EVERY statement pins `tenant_id =
-- app.tenant_id()` itself (and the entitlement's `user_id` to the user asked about): a course, live,
-- link or entitlement of another tenant matches nothing. EXECUTE is revoked from PUBLIC and granted
-- to `authenticated` only. No single-row LIMIT anywhere (pgTAP 040's allow-list).

alter table public.store_product_courses
  add constraint store_product_courses_course_fk
  foreign key (course_id) references public.courses(id) on delete cascade;
--> statement-breakpoint
alter table public.store_product_lives
  add constraint store_product_lives_live_fk
  foreign key (live_id) references public.course_lives(id) on delete cascade;
--> statement-breakpoint

revoke truncate on public.store_product_courses from authenticated;--> statement-breakpoint
revoke truncate on public.store_product_lives from authenticated;--> statement-breakpoint

insert into public.store_product_courses (tenant_id, product_id, course_id, created_at)
select tenant_id, product_id, course_id, created_at from public.course_products
on conflict (tenant_id, product_id, course_id) do nothing;--> statement-breakpoint
insert into public.store_product_lives (tenant_id, product_id, live_id, created_at)
select tenant_id, product_id, live_id, created_at from public.course_live_products
on conflict (tenant_id, product_id, live_id) do nothing;--> statement-breakpoint

do $$
begin
  if exists (select tenant_id, product_id, course_id from public.course_products
             except select tenant_id, product_id, course_id from public.store_product_courses)
  or exists (select tenant_id, product_id, course_id from public.store_product_courses
             except select tenant_id, product_id, course_id from public.course_products)
  then
    raise exception 'store_course_links: course link sets differ after the carry-over';
  end if;
  if exists (select tenant_id, product_id, live_id from public.course_live_products
             except select tenant_id, product_id, live_id from public.store_product_lives)
  or exists (select tenant_id, product_id, live_id from public.store_product_lives
             except select tenant_id, product_id, live_id from public.course_live_products)
  then
    raise exception 'store_course_links: live link sets differ after the carry-over';
  end if;
end $$;
--> statement-breakpoint

create or replace function app.course_locked_ids_for(p_user uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct l.course_id), '{}'::uuid[])
    from public.store_product_courses l
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
         from public.store_product_courses l2
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
        from public.store_product_courses l
       where l.tenant_id = app.tenant_id()
         and exists (select 1 from public.tenant_modules tm
                      where tm.tenant_id = l.tenant_id and tm.module_key = 'store' and tm.enabled)
         and exists (select 1 from public.tenant_modules tm
                      where tm.tenant_id = l.tenant_id and tm.module_key = 'courses' and tm.enabled)
         and not exists (
           select 1
             from public.store_product_courses l2
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
    from public.store_product_lives l
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
         from public.store_product_lives l2
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
        from public.store_product_lives l
       where l.tenant_id = app.tenant_id()
         and exists (select 1 from public.tenant_modules tm
                      where tm.tenant_id = l.tenant_id and tm.module_key = 'store' and tm.enabled)
         and exists (select 1 from public.tenant_modules tm
                      where tm.tenant_id = l.tenant_id and tm.module_key = 'courses' and tm.enabled)
         and not exists (
           select 1
             from public.store_product_lives l2
             join public.store_entitlements e
               on e.tenant_id = l2.tenant_id and e.product_id = l2.product_id
            where l2.tenant_id = l.tenant_id and l2.live_id = l.live_id
              and e.user_id = app.user_id() and e.status = 'active'))
  end
$$;
--> statement-breakpoint
revoke all on function app.live_locked_ids() from public;--> statement-breakpoint
grant execute on function app.live_locked_ids() to authenticated;
