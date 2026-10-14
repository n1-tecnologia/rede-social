-- 08.4-links-assert.sql — the carry-over proof across the WHOLE 08.4 migration chain (08.4-02,
-- COURSE-08, SC 4; D-418, D-405, PR-2).
--
-- Runs after `supabase migration up` applied, in order, file 1 (`*_store_course_links.sql`), file 2
-- (`*_store_course_links_functions.sql`: the carry-over, its guard, the gate swap) and file 3
-- (`*_drop_course_product_links.sql`: the drop). The 08.3 link tables are gone by now, so the ground
-- truth is `rehearsal.links_before` and `rehearsal.gate_before`, the snapshots
-- `08.4-links-fixture.sql` took before file 1 ran.
--
-- ONE `do` block that raises — and so makes `psql -v ON_ERROR_STOP=1` and the script exit non-zero
-- — unless every check holds:
--   1. every snapshotted link is in `public.store_product_courses` / `public.store_product_lives`
--      with the same `created_at`, and those two tables hold no row outside the snapshot (counted
--      both ways);
--   2. `rehearsal.gate_after`, recomputed with the SAME `rehearsal.gate_rows()`, equals
--      `rehearsal.gate_before` row for row in both directions; the first differing (tenant, user,
--      claim) is named with both answers;
--   3. the ARCHIVED course C3 and the CANCELLED live L3 still have their links and are still locked
--      for M2, who holds nothing (PR-2: a link to an archived or cancelled target survives the chain);
--   4. tenants C (`store` disabled) and D (no `courses` row) answer `'{}'` in every lane while their
--      link rows exist (SC 5, D-405);
--   5. `public.course_products` and `public.course_live_products` no longer exist.
-- Every failure is collected and raised together, gate difference first. Both count tables are
-- printed as notices, so the run's output is the record. The `rehearsal` schema is dropped at the
-- end (only reached on a pass; the script's EXIT trap resets the database either way).

create table rehearsal.gate_after as select * from rehearsal.gate_rows();

do $$
declare
  v_links int;
  v_missing int;
  v_extra int;
  v_store_rows int;
  v_gate_rows int;
  v_gate_missing int;
  v_gate_extra int;
  v_first record;
  v_after record;
  v_kept int;
  v_m2 record;
  v_dormant_links int;
  v_dormant_locked int;
  v_errors text[] := '{}';
  r record;
begin
  select count(*) into v_links from rehearsal.links_before;
  select count(*) into v_gate_rows from rehearsal.gate_before;
  if v_links = 0 or v_gate_rows = 0 then
    raise exception 'rehearsal: a snapshot is empty (% links, % gate rows) — the fixture did not load, nothing was proved',
      v_links, v_gate_rows;
  end if;

  raise notice 'rehearsal: links BEFORE (08.3 tables, snapshot), per (kind, tenant):';
  for r in select kind, tenant_id, count(*) as n from rehearsal.links_before group by 1, 2 order by 1, 2 loop
    raise notice '  %  %  %', r.kind, r.tenant_id, r.n;
  end loop;
  raise notice 'rehearsal: links AFTER (store tables, file 1 → file 2 → file 3), per (kind, tenant):';
  for r in
    select kind, tenant_id, count(*) as n
      from (select 'course'::text as kind, tenant_id from public.store_product_courses
            union all
            select 'live'::text, tenant_id from public.store_product_lives) s
     group by 1, 2 order by 1, 2
  loop
    raise notice '  %  %  %', r.kind, r.tenant_id, r.n;
  end loop;

  -- 2. every gate answer equals its snapshot, in both directions (EXCEPT treats NULL claims as equal)
  select count(*) into v_gate_missing
    from (select * from rehearsal.gate_before except select * from rehearsal.gate_after) d;
  select count(*) into v_gate_extra
    from (select * from rehearsal.gate_after except select * from rehearsal.gate_before) d;
  if v_gate_missing > 0 or v_gate_extra > 0 then
    select * into v_first
      from (select * from rehearsal.gate_before except select * from rehearsal.gate_after) d
     order by tenant_id, user_id, claim_role nulls first
     limit 1;
    if v_first is null then
      select * into v_first
        from (select * from rehearsal.gate_after except select * from rehearsal.gate_before) d
       order by tenant_id, user_id, claim_role nulls first
       limit 1;
    end if;
    select * into v_after from rehearsal.gate_after a
     where a.tenant_id = v_first.tenant_id and a.user_id = v_first.user_id
       and a.claim_role is not distinct from v_first.claim_role;
    select * into v_first from rehearsal.gate_before b
     where b.tenant_id = v_first.tenant_id and b.user_id = v_first.user_id
       and b.claim_role is not distinct from v_first.claim_role;
    v_errors := v_errors || format(
      'the gate answer of (tenant %s, user %s, claim %s) changed: before courses %s lives %s courses_for %s lives_for %s, after courses %s lives %s courses_for %s lives_for %s (%s snapshot rows missing, %s new rows)',
      coalesce(v_first.tenant_id, v_after.tenant_id), coalesce(v_first.user_id, v_after.user_id),
      coalesce(coalesce(v_first.claim_role, v_after.claim_role), 'NULL'),
      v_first.course_ids, v_first.live_ids, v_first.course_ids_for, v_first.live_ids_for,
      v_after.course_ids, v_after.live_ids, v_after.course_ids_for, v_after.live_ids_for,
      v_gate_missing, v_gate_extra);
  end if;

  -- 1. every link carried with its date, and nothing else in the store tables
  select count(*) into v_missing
    from rehearsal.links_before b
   where not exists (
     select 1 from public.store_product_courses s
      where b.kind = 'course' and s.tenant_id = b.tenant_id and s.product_id = b.product_id
        and s.course_id = b.target_id and s.created_at = b.created_at
     union all
     select 1 from public.store_product_lives s
      where b.kind = 'live' and s.tenant_id = b.tenant_id and s.product_id = b.product_id
        and s.live_id = b.target_id and s.created_at = b.created_at);
  select count(*) into v_extra
    from (select 'course'::text as kind, tenant_id, product_id, course_id as target_id, created_at
            from public.store_product_courses
          union all
          select 'live'::text, tenant_id, product_id, live_id, created_at
            from public.store_product_lives
          except
          select kind, tenant_id, product_id, target_id, created_at from rehearsal.links_before) x;
  select (select count(*) from public.store_product_courses) + (select count(*) from public.store_product_lives)
    into v_store_rows;
  if v_missing > 0 or v_extra > 0 or v_store_rows <> v_links then
    v_errors := v_errors || format(
      'links were lost or invented across the chain: %s snapshot links missing (or with another created_at), %s store rows outside the snapshot, %s store rows vs %s snapshot links',
      v_missing, v_extra, v_store_rows, v_links);
  end if;

  -- 3. PR-2: the archived course and the cancelled live keep their links and stay locked for M2
  select (select count(*) from public.store_product_courses
           where course_id = '84a00000-0000-4000-8000-0000000000c3'
             and product_id = '84a00000-0000-4000-8000-0000000000a1')
       + (select count(*) from public.store_product_lives
           where live_id = '84a00000-0000-4000-8000-000000000b03'
             and product_id = '84a00000-0000-4000-8000-0000000000a1')
    into v_kept;
  select * into v_m2 from rehearsal.gate_after
   where tenant_id = '84a00000-0000-4000-8000-000000000001'
     and user_id = '84a00000-0000-4000-8000-000000000005' and claim_role = 'member';
  if v_kept <> 2
     or v_m2 is null
     or not ('84a00000-0000-4000-8000-0000000000c3'::uuid = any (v_m2.course_ids))
     or not ('84a00000-0000-4000-8000-0000000000c3'::uuid = any (v_m2.course_ids_for))
     or not ('84a00000-0000-4000-8000-000000000b03'::uuid = any (v_m2.live_ids))
     or not ('84a00000-0000-4000-8000-000000000b03'::uuid = any (v_m2.live_ids_for)) then
    v_errors := v_errors || format(
      'PR-2: the archived course C3 / cancelled live L3 lost a link (%s of 2 kept) or opened for M2 (courses %s, lives %s, courses_for %s, lives_for %s)',
      v_kept, v_m2.course_ids, v_m2.live_ids, v_m2.course_ids_for, v_m2.live_ids_for);
  end if;

  -- 4. D-405: C (store disabled) and D (no courses row) are inert in every lane while links exist
  select (select count(*) from public.store_product_courses
           where tenant_id in ('84c00000-0000-4000-8000-000000000001', '84d00000-0000-4000-8000-000000000001'))
       + (select count(*) from public.store_product_lives
           where tenant_id in ('84c00000-0000-4000-8000-000000000001', '84d00000-0000-4000-8000-000000000001'))
    into v_dormant_links;
  select count(*) into v_dormant_locked
    from rehearsal.gate_after
   where tenant_id in ('84c00000-0000-4000-8000-000000000001', '84d00000-0000-4000-8000-000000000001')
     and (course_ids <> '{}' or live_ids <> '{}' or course_ids_for <> '{}' or live_ids_for <> '{}');
  if v_dormant_links <> 4 or v_dormant_locked > 0
     or not exists (select 1 from rehearsal.gate_after
                     where tenant_id in ('84c00000-0000-4000-8000-000000000001', '84d00000-0000-4000-8000-000000000001')) then
    v_errors := v_errors || format(
      'D-405: tenants C and D should hold 4 dormant links and lock nothing; they hold %s links and %s lanes lock something',
      v_dormant_links, v_dormant_locked);
  end if;

  -- 5. the 08.3 tables are gone
  if to_regclass('public.course_products') is not null or to_regclass('public.course_live_products') is not null then
    v_errors := v_errors || 'an 08.3 link table still exists — file 3 did not run'::text;
  end if;

  raise notice 'rehearsal: % links snapshotted, % store rows; missing %, invented %; % gate rows, % changed, % new; C3/L3 links kept %; C/D dormant links %, C/D lanes locking %',
    v_links, v_store_rows, v_missing, v_extra, v_gate_rows, v_gate_missing, v_gate_extra, v_kept,
    v_dormant_links, v_dormant_locked;

  if cardinality(v_errors) > 0 then
    raise exception 'rehearsal: FAIL — %', array_to_string(v_errors, '; ');
  end if;

  raise notice 'rehearsal: PASS — every link is in the store tables with its date, no gate answer changed, and the 08.3 tables are gone';
end $$;

drop schema rehearsal cascade;
