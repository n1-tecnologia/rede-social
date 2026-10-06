begin;
-- 111-community-position.sql — the admin's order of the Comunidades list (2026-10-03), as the facts
-- only the database can prove. `110-communities-stories.sql` cases 17-18 pin the FIRST page's plan
-- (the list is served by `communities_tenant_position_idx`, no sort); this file owns the rest:
--
-- 1. THE COLUMN. `communities.position` is `integer NOT NULL DEFAULT 0`, so every existing row and
--    every community created later starts at 0 — which is what makes the list read exactly as D-76's
--    activity order until an admin reorders, and what lists a community created AFTER a reorder
--    (written 1..n) first.
--
-- 2. THE INDEX, verbatim. Tenant first (the §(j) convention), then `position` ascending and D-76's
--    `last_activity_at desc, id desc` as the tie-breakers, partial on the list's own predicate. A
--    change to any column or direction would make the planner sort, so the definition is pinned as
--    text rather than by name alone.
--
-- 3. THE ORDER, with the list statement VERBATIM from `activePage` in
--    `packages/modules/communities/server/service.ts` (page 1: every cursor parameter null). The
--    fixture holds a tie inside one position (only `id desc` separates the pair), an archived row
--    and a removed row, each with its positive control in the same statement.
--
-- 4. THE KEYSET ACROSS POSITIONS — the same statement with a cursor: in the middle of a tied group
--    (it continues inside the group, then crosses into the next position), at a group's last row,
--    and past the end. MIXED directions (position ascending, activity descending) are what this
--    predicate exists for; a plain row comparison would page it into repeats and skips.
--
-- 5. THE RENUMBER, verbatim from `reorderCommunities`: `position = 1..n` in the order of the array;
--    a repeat writes NOTHING (not even `updated_at`); and a row the API would never send — archived,
--    or removed — is not touched even when the array names it, because the statement carries the
--    list's own predicate as well as the service's set check.
--
-- 6. A LATER PAGE SEEKS. On a volume fixture, the keyset statement with a cursor (the literals a
--    custom plan sees) is an index scan on `communities_tenant_position_idx` whose index condition
--    starts at the cursor's position (`position >= p`), with no sort and no sequential scan.
--
-- Like its siblings, this file ROLLS BACK, so it re-runs identically against a seeded or an empty
-- database, twice in a row, in any order.
select plan(16);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-comm-order', 'Ordem das comunidades', '0f110000-0000-4000-8000-000000000001');
select tests.auth_user('order@c.local', '0f110000-0000-4000-8000-000000000002');
select tests.member('0f110000-0000-4000-8000-000000000001', '0f110000-0000-4000-8000-000000000002');

-- c1 at 0 (newest); c2 at 1; c3 and c4 at 2 with the SAME instant (c4 > c3, so c4 first); c5 at 3
-- (newer than c3/c4 — position wins over activity); c6 archived; c7 removed. `created_at` equals
-- `last_activity_at` on every row (the counters' invariant for a community with no posts).
insert into public.communities
  (id, tenant_id, created_by_user_id, name, slug, status, position, created_at, last_activity_at, deleted_at)
values
  ('0f110000-0000-4000-8000-0000000000c1', '0f110000-0000-4000-8000-000000000001',
   '0f110000-0000-4000-8000-000000000002', 'Um', 'um', 'active', 0,
   '2026-09-01 12:00:00.000001+00', '2026-09-01 12:00:00.000001+00', null),
  ('0f110000-0000-4000-8000-0000000000c2', '0f110000-0000-4000-8000-000000000001',
   '0f110000-0000-4000-8000-000000000002', 'Dois', 'dois', 'active', 1,
   '2026-09-01 08:00:00+00', '2026-09-01 08:00:00+00', null),
  ('0f110000-0000-4000-8000-0000000000c3', '0f110000-0000-4000-8000-000000000001',
   '0f110000-0000-4000-8000-000000000002', 'Tres', 'tres', 'active', 2,
   '2026-09-01 10:00:00.123456+00', '2026-09-01 10:00:00.123456+00', null),
  ('0f110000-0000-4000-8000-0000000000c4', '0f110000-0000-4000-8000-000000000001',
   '0f110000-0000-4000-8000-000000000002', 'Quatro', 'quatro', 'active', 2,
   '2026-09-01 10:00:00.123456+00', '2026-09-01 10:00:00.123456+00', null),
  ('0f110000-0000-4000-8000-0000000000c5', '0f110000-0000-4000-8000-000000000001',
   '0f110000-0000-4000-8000-000000000002', 'Cinco', 'cinco', 'active', 3,
   '2026-09-01 11:30:00+00', '2026-09-01 11:30:00+00', null),
  ('0f110000-0000-4000-8000-0000000000c6', '0f110000-0000-4000-8000-000000000001',
   '0f110000-0000-4000-8000-000000000002', 'Arquivada', 'arquivada', 'archived', 1,
   '2026-09-01 13:00:00+00', '2026-09-01 13:00:00+00', null),
  ('0f110000-0000-4000-8000-0000000000c7', '0f110000-0000-4000-8000-000000000001',
   '0f110000-0000-4000-8000-000000000002', 'Removida', 'removida', 'active', 0,
   '2026-09-01 14:00:00+00', '2026-09-01 14:00:00+00', now());

-- ── 1-3. the column ────────────────────────────────────────────────────────────────────────────
select col_type_is('public', 'communities', 'position', 'integer',
  'communities.position is an integer');
select col_not_null('public', 'communities', 'position',
  'communities.position is NOT NULL: every row has a place in the order');
select col_default_is('public', 'communities', 'position', '0',
  'communities.position defaults to 0: the list reads as the activity order until an admin reorders');

-- ── 4. the index, verbatim ─────────────────────────────────────────────────────────────────────
select is(
  pg_get_indexdef('public.communities_tenant_position_idx'::regclass),
  'CREATE INDEX communities_tenant_position_idx ON public.communities USING btree (tenant_id, "position", last_activity_at DESC, id DESC) WHERE ((status = ''active''::text) AND (deleted_at IS NULL))',
  'communities_tenant_position_idx: tenant first, position asc, then D-76''s tie-breakers, partial on the list predicate'
);

-- ── 5. the order: page 1, verbatim from `activePage` ───────────────────────────────────────────
select results_eq(
  $$ select c.id::text from public.communities c
      where c.tenant_id = '0f110000-0000-4000-8000-000000000001'::uuid
        and c.deleted_at is null
        and c.status = 'active'
        and (
          null::int is null
          or (
            c.position >= null::int
            and (
              c.position > null::int
              or (c.last_activity_at, c.id) < (null::timestamptz, null::uuid)
            )
          )
        )
      order by c.position asc, c.last_activity_at desc, c.id desc
      limit 11 $$,
  ARRAY['0f110000-0000-4000-8000-0000000000c1', '0f110000-0000-4000-8000-0000000000c2',
        '0f110000-0000-4000-8000-0000000000c4', '0f110000-0000-4000-8000-0000000000c3',
        '0f110000-0000-4000-8000-0000000000c5'],
  'page 1: position first, activity inside it, the tie by id desc; the archived and the removed row are absent'
);

-- ── 6-8. the keyset across positions ───────────────────────────────────────────────────────────
-- After c4 — the FIRST of a tied pair: the page continues with its tie partner, then crosses into
-- position 3. A `<` on the instant alone would have skipped c3.
select results_eq(
  $$ select c.id::text from public.communities c
      where c.tenant_id = '0f110000-0000-4000-8000-000000000001'::uuid
        and c.deleted_at is null
        and c.status = 'active'
        and (
          2::int is null
          or (
            c.position >= 2::int
            and (
              c.position > 2::int
              or (c.last_activity_at, c.id)
                 < ('2026-09-01 10:00:00.123456+00'::timestamptz,
                    '0f110000-0000-4000-8000-0000000000c4'::uuid)
            )
          )
        )
      order by c.position asc, c.last_activity_at desc, c.id desc
      limit 11 $$,
  ARRAY['0f110000-0000-4000-8000-0000000000c3', '0f110000-0000-4000-8000-0000000000c5'],
  'after the first of a tie: its partner inside the same position, then the next position'
);
-- After c2 — the LAST row of position 1: everything of the later positions, in order, and never c2
-- again nor the archived row that shares its position.
select results_eq(
  $$ select c.id::text from public.communities c
      where c.tenant_id = '0f110000-0000-4000-8000-000000000001'::uuid
        and c.deleted_at is null
        and c.status = 'active'
        and (
          1::int is null
          or (
            c.position >= 1::int
            and (
              c.position > 1::int
              or (c.last_activity_at, c.id)
                 < ('2026-09-01 08:00:00+00'::timestamptz,
                    '0f110000-0000-4000-8000-0000000000c2'::uuid)
            )
          )
        )
      order by c.position asc, c.last_activity_at desc, c.id desc
      limit 11 $$,
  ARRAY['0f110000-0000-4000-8000-0000000000c4', '0f110000-0000-4000-8000-0000000000c3',
        '0f110000-0000-4000-8000-0000000000c5'],
  'after a group''s last row: the next positions in order, the cursor row never repeated'
);
-- After c5 — the last row of the list: an empty page, never a wrap-around to the lower positions.
select is_empty(
  $$ select c.id from public.communities c
      where c.tenant_id = '0f110000-0000-4000-8000-000000000001'::uuid
        and c.deleted_at is null
        and c.status = 'active'
        and (
          3::int is null
          or (
            c.position >= 3::int
            and (
              c.position > 3::int
              or (c.last_activity_at, c.id)
                 < ('2026-09-01 11:30:00+00'::timestamptz,
                    '0f110000-0000-4000-8000-0000000000c5'::uuid)
            )
          )
        )
      order by c.position asc, c.last_activity_at desc, c.id desc
      limit 11 $$,
  'past the last row: an empty page, never a wrap-around to the lower positions'
);

-- ── 9-12. the renumber, verbatim from `reorderCommunities` ─────────────────────────────────────
update communities c
   set position = o.ord::int,
       updated_at = now()
  from unnest('{0f110000-0000-4000-8000-0000000000c5,0f110000-0000-4000-8000-0000000000c4,0f110000-0000-4000-8000-0000000000c3,0f110000-0000-4000-8000-0000000000c2,0f110000-0000-4000-8000-0000000000c1}'::uuid[])
       with ordinality as o(id, ord)
 where c.id = o.id
   and c.tenant_id = '0f110000-0000-4000-8000-000000000001'::uuid
   and c.deleted_at is null
   and c.status = 'active'
   and c.position <> o.ord;

select results_eq(
  $$ select c.id::text from public.communities c
      where c.tenant_id = '0f110000-0000-4000-8000-000000000001'::uuid
        and c.deleted_at is null
        and c.status = 'active'
      order by c.position asc, c.last_activity_at desc, c.id desc $$,
  ARRAY['0f110000-0000-4000-8000-0000000000c5', '0f110000-0000-4000-8000-0000000000c4',
        '0f110000-0000-4000-8000-0000000000c3', '0f110000-0000-4000-8000-0000000000c2',
        '0f110000-0000-4000-8000-0000000000c1'],
  'the renumber is the order the array names — activity no longer decides between them'
);
select results_eq(
  $$ select c.position from public.communities c
      where c.tenant_id = '0f110000-0000-4000-8000-000000000001'::uuid
        and c.deleted_at is null and c.status = 'active'
      order by c.position $$,
  ARRAY[1, 2, 3, 4, 5],
  'positions are dense 1..n'
);

-- A repeat of the same order writes NOTHING: every row is stamped with a sentinel first, so any row
-- the second statement touched would carry `now()` again.
update public.communities set updated_at = '2000-01-01 00:00:00+00'
 where tenant_id = '0f110000-0000-4000-8000-000000000001'::uuid;

update communities c
   set position = o.ord::int,
       updated_at = now()
  from unnest('{0f110000-0000-4000-8000-0000000000c5,0f110000-0000-4000-8000-0000000000c4,0f110000-0000-4000-8000-0000000000c3,0f110000-0000-4000-8000-0000000000c2,0f110000-0000-4000-8000-0000000000c1}'::uuid[])
       with ordinality as o(id, ord)
 where c.id = o.id
   and c.tenant_id = '0f110000-0000-4000-8000-000000000001'::uuid
   and c.deleted_at is null
   and c.status = 'active'
   and c.position <> o.ord;

select is_empty(
  $$ select c.id from public.communities c
      where c.tenant_id = '0f110000-0000-4000-8000-000000000001'::uuid
        and c.updated_at <> '2000-01-01 00:00:00+00'::timestamptz $$,
  'repeating the same order touches no row: not one position, not one updated_at'
);

-- The removed row and the archived row, NAMED by an array: c7 would move 0 -> 1 and c6 1 -> 2 if the
-- statement only trusted the service's set check. It carries the list predicate as well.
update communities c
   set position = o.ord::int,
       updated_at = now()
  from unnest('{0f110000-0000-4000-8000-0000000000c7,0f110000-0000-4000-8000-0000000000c6}'::uuid[])
       with ordinality as o(id, ord)
 where c.id = o.id
   and c.tenant_id = '0f110000-0000-4000-8000-000000000001'::uuid
   and c.deleted_at is null
   and c.status = 'active'
   and c.position <> o.ord;

select results_eq(
  $$ select c.position, c.updated_at = '2000-01-01 00:00:00+00'::timestamptz
       from public.communities c
      where c.id in ('0f110000-0000-4000-8000-0000000000c6', '0f110000-0000-4000-8000-0000000000c7')
      order by c.id $$,
  $$ values (1, true), (0, true) $$,
  'an archived or removed row is never renumbered, even when the array names it'
);

-- ── 13. a community created after a reorder is listed FIRST ────────────────────────────────────
-- No `position` in the insert, and an activity older than every row: the column default (0) still
-- puts it ahead of the 1..n the reorder wrote.
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, created_at, last_activity_at)
values ('0f110000-0000-4000-8000-0000000000c8', '0f110000-0000-4000-8000-000000000001',
        '0f110000-0000-4000-8000-000000000002', 'Nova', 'nova',
        '2020-01-01 00:00:00+00', '2020-01-01 00:00:00+00');

select results_eq(
  $$ select c.id::text from public.communities c
      where c.tenant_id = '0f110000-0000-4000-8000-000000000001'::uuid
        and c.deleted_at is null
        and c.status = 'active'
      order by c.position asc, c.last_activity_at desc, c.id desc
      limit 1 $$,
  ARRAY['0f110000-0000-4000-8000-0000000000c8'],
  'a community created after the reorder (default 0) heads the list, whatever its activity'
);

-- ── 14-16. a later page SEEKS to the cursor's position ─────────────────────────────────────────
-- 400 more rows in this tenant, spread over seven positions. `analyze` is what makes the planner act
-- on any of it. The plan is collected as TEXT (one line per node) so the index condition can be read.
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, position, created_at, last_activity_at)
select ('0f11c0' || lpad(to_hex(g), 26, '0'))::uuid,
       '0f110000-0000-4000-8000-000000000001',
       '0f110000-0000-4000-8000-000000000002',
       'Volume ' || g,
       'volume-' || g,
       g % 7,
       now() - (g || ' minutes')::interval,
       now() - (g || ' minutes')::interval
  from generate_series(1, 400) g;

analyze public.communities;

create temporary table order_plans (name text primary key, plan text);

do $$
declare
  v_line text;
  v_plan text := '';
begin
  for v_line in execute
    'explain select c.id, c.last_activity_at from public.communities c
      where c.tenant_id = ''0f110000-0000-4000-8000-000000000001''::uuid
        and c.deleted_at is null
        and c.status = ''active''
        and (
          3::int is null
          or (
            c.position >= 3::int
            and (
              c.position > 3::int
              or (c.last_activity_at, c.id) < (now() - interval ''100 minutes'',
                                                ''0f11c000-0000-0000-0000-000000000064''::uuid)
            )
          )
        )
      order by c.position asc, c.last_activity_at desc, c.id desc
      limit 11'
  loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  insert into order_plans values ('after_cursor', v_plan);
end
$$;

select matches(
  (select plan from order_plans where name = 'after_cursor'),
  'communities_tenant_position_idx',
  'a page after a cursor is served by communities_tenant_position_idx, BY NAME'
);
select matches(
  (select plan from order_plans where name = 'after_cursor'),
  'Index Cond: .*"position" >= 3',
  '…seeking to the cursor''s position (position >= p is an index condition, not a filter)'
);
select doesnt_match(
  (select plan from order_plans where name = 'after_cursor'),
  'Sort|Seq Scan',
  '…with no sort and no sequential scan'
);

select * from finish();
rollback;
