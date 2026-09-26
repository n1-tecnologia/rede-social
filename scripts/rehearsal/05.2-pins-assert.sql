-- 05.2-pins-assert.sql — the no-loss proof across the WHOLE migration chain (05.2-11, D-116).
--
-- Runs after `supabase migration up` applied, in order, migration file 1 (`*_story_highlights.sql`:
-- the pin → `Destaques` backfill and its guard), `*_story_views.sql`, and migration file 2
-- (`*_drop_story_community_pins.sql`: the drop). The pin table is gone by now, so the ground truth
-- is `rehearsal.pins_before`, the snapshot `05.2-pins-fixture.sql` took before file 1 ran.
--
-- ONE `do` block that raises — and so makes `psql -v ON_ERROR_STOP=1` and the script exit non-zero
-- — unless every check holds:
--   1. every snapshotted pin is EXACTLY ONE item under a `Destaques` highlight of its own
--      (tenant, community), with the same story, the same adder and `added_at = pinned_at`;
--   2. per (tenant, community), the item count under `Destaques` equals the pin count, and no
--      `Destaques` exists anywhere the snapshot had no pin;
--   3. the community with NO pins got NO highlight at all (the empty edge);
--   4. adjacency: the story pinned to TWO communities is TWO items under TWO highlights, never one;
--   5. the EXPIRED pinned story is returned by the member items read — `getHighlight`'s statement
--      shape, which carries no expiry clause — and that read plays by PUBLISH time, oldest first;
--   6. `public.story_community_pins` no longer exists.
-- Both count tables are printed as notices, so the run's output is the record (T-05.2-54). The
-- `rehearsal` schema is dropped at the end.

do $$
declare
  v_pins int;
  v_missing int;
  v_duplicated int;
  v_mismatch int;
  v_empty_highlights int;
  v_adjacent int;
  v_order text;
  r record;
begin
  select count(*) into v_pins from rehearsal.pins_before;
  if v_pins = 0 then
    raise exception 'rehearsal: the snapshot is empty — the fixture did not load, nothing was proved';
  end if;

  raise notice 'rehearsal: pins BEFORE (snapshot), per (tenant, community):';
  for r in
    select tenant_id, community_id, count(*) as n
      from rehearsal.pins_before group by 1, 2 order by 1, 2
  loop
    raise notice '  %  %  %', r.tenant_id, r.community_id, r.n;
  end loop;

  raise notice 'rehearsal: Destaques items AFTER (file 1 → story_views → file 2), per (tenant, community):';
  for r in
    select h.tenant_id, h.community_id, count(i.id) as n
      from public.story_highlights h
      left join public.story_highlight_items i on i.highlight_id = h.id
     where h.title = 'Destaques'
     group by 1, 2 order by 1, 2
  loop
    raise notice '  %  %  %', r.tenant_id, r.community_id, r.n;
  end loop;

  -- 1. every pin is exactly one identical item under its own community's Destaques
  select count(*) into v_missing
    from rehearsal.pins_before p
   where (select count(*)
            from public.story_highlight_items i
            join public.story_highlights h on h.id = i.highlight_id
           where h.title = 'Destaques'
             and h.tenant_id = p.tenant_id
             and h.community_id = p.community_id
             and i.tenant_id = p.tenant_id
             and i.story_id = p.story_id
             and i.added_by_user_id = p.pinned_by_user_id
             and i.added_at = p.pinned_at) <> 1;

  select count(*) into v_duplicated
    from (select h.tenant_id, h.community_id
            from public.story_highlights h
           where h.title = 'Destaques'
           group by 1, 2
          having count(*) > 1) d;

  -- 2. per-community counts match, in both directions (a full join finds an invented Destaques too)
  select count(*) into v_mismatch
    from (select tenant_id, community_id, count(*) as n
            from rehearsal.pins_before group by 1, 2) a
    full join (select h.tenant_id, h.community_id, count(i.id) as n
                 from public.story_highlights h
                 left join public.story_highlight_items i on i.highlight_id = h.id
                where h.title = 'Destaques'
                group by 1, 2) b using (tenant_id, community_id)
   where a.n is distinct from b.n;

  -- 3. the community with no pins has no highlight of any title
  select count(*) into v_empty_highlights
    from public.story_highlights
   where community_id = '5a000000-0000-4000-8000-0000000000c4';

  -- 4. adjacency: the story pinned to c1 AND c2 sits in two distinct highlights
  select count(distinct i.highlight_id) into v_adjacent
    from public.story_highlight_items i
    join public.story_highlights h on h.id = i.highlight_id
   where i.story_id = '5a000000-0000-4000-8000-0000000000e1'
     and h.community_id in ('5a000000-0000-4000-8000-0000000000c1',
                            '5a000000-0000-4000-8000-0000000000c2');

  -- 5. the member items read of c1's Destaques, verbatim in shape: no expiry clause, publish order
  select string_agg(s.caption, ',' order by s.published_at, s.id) into v_order
    from public.story_highlight_items i
    join public.story_highlights h on h.id = i.highlight_id
    join public.stories s on s.id = i.story_id and s.tenant_id = i.tenant_id
    join public.media_assets a on a.id = s.media_asset_id
   where h.tenant_id = '5a000000-0000-4000-8000-000000000001'
     and h.community_id = '5a000000-0000-4000-8000-0000000000c1'
     and h.title = 'Destaques'
     and i.tenant_id = h.tenant_id
     and s.deleted_at is null and a.status = 'ready';

  raise notice 'rehearsal: % pins snapshotted; missing %, duplicated highlights %, mismatched communities %, highlights on the no-pin community %, highlights holding the two-community story %, c1 items read "%"',
    v_pins, v_missing, v_duplicated, v_mismatch, v_empty_highlights, v_adjacent, v_order;

  if v_missing > 0 or v_duplicated > 0 or v_mismatch > 0 then
    raise exception 'rehearsal: pins were lost or merged across file 1 → file 2: % missing, % duplicated, % communities mismatched',
      v_missing, v_duplicated, v_mismatch;
  end if;
  if v_empty_highlights > 0 then
    raise exception 'rehearsal: the community with no pins got % highlight(s) — the backfill invented one',
      v_empty_highlights;
  end if;
  if v_adjacent <> 2 then
    raise exception 'rehearsal: the story pinned to two communities sits in % highlight(s), expected 2',
      v_adjacent;
  end if;
  if v_order is distinct from 'expirada,ativa' then
    raise exception 'rehearsal: c1''s items read returned "%", expected the EXPIRED story then the active one (publish order)',
      coalesce(v_order, '<nothing>');
  end if;
  if to_regclass('public.story_community_pins') is not null then
    raise exception 'rehearsal: public.story_community_pins still exists — file 2 did not run';
  end if;

  raise notice 'rehearsal: PASS — every pin is one item under its own Destaques, and the pin table is gone';
end $$;

drop schema rehearsal cascade;
