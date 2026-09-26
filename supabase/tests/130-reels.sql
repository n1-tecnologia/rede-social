begin;
-- 130-reels.sql — the `reels` module key, its backfill and Reels' 'Todos' plan, inside Postgres (05.3-01).
--
-- Reels (D-121) is its own module with NO tables: it reads posts through feed's published contract
-- (`GET /v1/feed?media=video`). What the database owns for it is therefore small, and every piece of
-- it is a fact only the database can prove, because a migration, a worker or a psql session could
-- bypass the API. Each block ships its POSITIVE CONTROL in the same block, so a fixture that failed
-- globally, or a constraint that refused everything, could not make a refusal pass. Constraint and
-- index names are asserted VERBATIM, so a rename breaks this file instead of silently leaving a
-- test that proves something else.
--
-- 1. THE KEY VOCABULARY (D-122). `tenant_modules_key_chk` is generated from `TOGGLEABLE_MODULES`;
--    05.3-01 appended `'reels'`. The key is accepted; a near miss (`'reel'`) is still refused 23514
--    with the constraint's own message — so the CHECK was widened, not dropped.
--
-- 2. THE BACKFILL'S SEMANTICS (D-122, T-05.3-04). The statement below is copied VERBATIM from
--    `supabase/migrations/20260926184147_reels_module.sql`. Locally `db reset` migrates an EMPTY
--    database and seeds afterwards, so the migration's own run touched no row; this block replays it
--    on fixtures that make every branch real:
--    - tenant A has NO `reels` row → after one run it has exactly one, enabled;
--    - tenant B already has `reels` DISABLED (a super_admin switched it off) → it stays disabled,
--      because `on conflict (tenant_id, module_key) do nothing` never overwrites a flag;
--    - a SECOND run writes no second row for either tenant (idempotent).
--    The precondition (A starts with no row) is asserted first, so "exactly one row" cannot pass on a
--    fixture that already had it.
--
-- 3. THE 'TODOS' PLAN (planning decision 6, REELS-03, T-05.3-05). On a volume fixture — 5,000 posts
--    in one tenant, one in ten `media_kind = 'video'`, each video post with a READY video media row,
--    `analyze`d — the 'Todos' statement with feed's `READY_VIDEO_POST` predicate (copied verbatim in
--    shape: the literal `'video'` / `'ready'`, never bound parameters) plans through
--    `feed_posts_tenant_video_created_idx` BY NAME and shows no `Seq Scan on feed_posts`, for the
--    communities-ON statement (no community predicate, D-73) and the communities-OFF one
--    (`and p.community_id is null`, D-74) alike. Pinning the index by name is what turns a future
--    `drop index` into a red run instead of dead weight nobody notices. Plans are captured in TEXT
--    format, where `Seq Scan on feed_posts` is literally what a sequential scan prints (the JSON
--    format splits it into two keys, which would make the negative check vacuous — 120's lesson).
--    The predicates mirror what RLS injects (`tenant_id = app.tenant_id()`), since pg_prove connects
--    as the table owner and does not have the policy applied for it.
--    WHY 5,000 AND NOT 400 (measured 2026-09-26, executor 05.3-01): with the `exists` in the
--    statement the planner estimates the semi-join at about a tenth of the video rows (it cannot
--    know every video post has its media row), so below a few thousand posts the LIMIT promises no
--    early exit and `Hash Semi Join` over a `Seq Scan on feed_posts` is the cheaper plan — that is
--    what 400 and 1,000 posts produced. On a compacted heap the partial index wins from about 4,000
--    posts (Bitmap Index Scan) and at 5,000 it is an ordered Index Scan feeding a Nested Loop Semi
--    Join through `feed_post_media_video_uq`, for both statements. A small tenant seq-scanning a
--    small table is cheap; the index exists for the volume where a seq scan would not be.
--
-- Plan 05.3-02 extends this file with the lanes facts; keep the `plan(N)` count exact. Like its
-- siblings it ROLLS BACK, so it re-runs identically against a seeded or an empty database, twice in
-- a row, in any order (TENANT-05 ordering).
select plan(13);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
-- V: the vocabulary and volume tenant. A: no reels row. B: reels already DISABLED.
select tests.tenant('pgtap-reels-v', 'Reels Volume', '1c000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-reels-a', 'Reels Sem Linha', '1c000000-0000-4000-8000-000000000011');
select tests.tenant('pgtap-reels-b', 'Reels Desligado', '1c000000-0000-4000-8000-000000000021');
select tests.auth_user('reels-author@130.local', '1c000000-0000-4000-8000-000000000002');

insert into public.tenant_modules (tenant_id, module_key, enabled)
values ('1c000000-0000-4000-8000-000000000021', 'reels', false);

-- ══ 1-2. THE KEY VOCABULARY ═════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into public.tenant_modules (tenant_id, module_key, enabled)
     values ('1c000000-0000-4000-8000-000000000001', 'reel', true) $$,
  '23514',
  'new row for relation "tenant_modules" violates check constraint "tenant_modules_key_chk"',
  'D-122: tenant_modules_key_chk still refuses a key outside the vocabulary (''reel'')'
);
select lives_ok(
  $$ insert into public.tenant_modules (tenant_id, module_key, enabled)
     values ('1c000000-0000-4000-8000-000000000001', 'reels', true) $$,
  'positive control: the widened CHECK accepts ''reels'' on the same table in the same transaction'
);

-- ══ 3-8. THE BACKFILL'S SEMANTICS ═══════════════════════════════════════════════════════════════
select is_empty(
  $$ select 1 from public.tenant_modules
      where tenant_id = '1c000000-0000-4000-8000-000000000011' and module_key = 'reels' $$,
  'precondition: tenant A starts with NO reels row, so the backfill has a row to write'
);
-- Verbatim from the migration.
select lives_ok(
  $$ insert into public.tenant_modules (tenant_id, module_key, enabled)
     select t.id, 'reels', true from public.tenants t
     on conflict (tenant_id, module_key) do nothing $$,
  'D-122: the backfill statement runs (first run)'
);
select results_eq(
  $$ select enabled from public.tenant_modules
      where tenant_id = '1c000000-0000-4000-8000-000000000011' and module_key = 'reels' $$,
  ARRAY[true],
  'D-122: a tenant without a reels row gets exactly one, enabled'
);
select results_eq(
  $$ select enabled from public.tenant_modules
      where tenant_id = '1c000000-0000-4000-8000-000000000021' and module_key = 'reels' $$,
  ARRAY[false],
  'T-05.3-04: a tenant whose reels row already exists keeps it DISABLED (do nothing, never overwrite)'
);
select lives_ok(
  $$ insert into public.tenant_modules (tenant_id, module_key, enabled)
     select t.id, 'reels', true from public.tenants t
     on conflict (tenant_id, module_key) do nothing $$,
  'D-122: the backfill statement runs again (second run)'
);
select results_eq(
  $$ select count(*)::int from public.tenant_modules
      where tenant_id in ('1c000000-0000-4000-8000-000000000011',
                          '1c000000-0000-4000-8000-000000000021')
        and module_key = 'reels'
      group by tenant_id order by tenant_id $$,
  ARRAY[1, 1],
  'idempotent: after two runs each tenant still has exactly one reels row'
);

-- ══ 9-13. THE 'TODOS' PLAN ══════════════════════════════════════════════════════════════════════
select ok(
  exists (select 1 from pg_indexes
           where schemaname = 'public'
             and tablename = 'feed_posts'
             and indexname = 'feed_posts_tenant_video_created_idx'
             and indexdef like '%(tenant_id, created_at DESC, id DESC) WHERE (media_kind = ''video''::text)%'),
  'feed_posts_tenant_video_created_idx exists by name: (tenant_id, created_at desc, id desc) where media_kind = ''video'''
);

-- The volume fixture: 5,000 posts, every tenth one a video post with its READY video media row.
insert into public.feed_posts (id, tenant_id, author_user_id, caption, media_kind, created_at)
select ('1c00f100-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       '1c000000-0000-4000-8000-000000000001',
       '1c000000-0000-4000-8000-000000000002',
       'volume ' || g,
       case when g % 10 = 0 then 'video' else 'none' end,
       now() - (g || ' minutes')::interval
  from generate_series(1, 5000) g;

insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes)
select ('1c00a100-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       '1c000000-0000-4000-8000-000000000001',
       '1c000000-0000-4000-8000-000000000002',
       'video', 'post', 'ready', 'video/mp4', 1024
  from generate_series(10, 5000, 10) g;

insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
select '1c000000-0000-4000-8000-000000000001',
       ('1c00f100-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'video',
       ('1c00a100-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'video', 0
  from generate_series(10, 5000, 10) g;

analyze public.feed_posts;
analyze public.feed_post_media;
analyze public.media_assets;

create temporary table reels_plans (name text primary key, plan text);

do $$
declare
  r record;
  v_plan text;
begin
  -- Communities ON (D-73): no community predicate, then READY_VIDEO_POST.
  v_plan := '';
  for r in execute
    'explain select p.id, p.created_at from public.feed_posts p
      where p.tenant_id = ''1c000000-0000-4000-8000-000000000001''
        and p.deleted_at is null
        and p.media_kind = ''video''
        and exists (
          select 1
            from public.feed_post_media vm
            join public.media_assets va on va.id = vm.media_asset_id
           where vm.post_id = p.id
             and vm.kind = ''video''
             and va.status = ''ready'')
      order by p.created_at desc, p.id desc limit 11'
  loop
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  end loop;
  insert into reels_plans values ('todos', v_plan);

  -- Communities OFF (D-74): Phase 4's `community_id is null`, then the same READY_VIDEO_POST.
  v_plan := '';
  for r in execute
    'explain select p.id, p.created_at from public.feed_posts p
      where p.tenant_id = ''1c000000-0000-4000-8000-000000000001''
        and p.deleted_at is null
        and p.community_id is null
        and p.media_kind = ''video''
        and exists (
          select 1
            from public.feed_post_media vm
            join public.media_assets va on va.id = vm.media_asset_id
           where vm.post_id = p.id
             and vm.kind = ''video''
             and va.status = ''ready'')
      order by p.created_at desc, p.id desc limit 11'
  loop
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  end loop;
  insert into reels_plans values ('todos_off', v_plan);
end
$$;

select matches(
  (select plan from reels_plans where name = 'todos'),
  'feed_posts_tenant_video_created_idx',
  'REELS-03: the ''Todos'' page (communities ON) is served by feed_posts_tenant_video_created_idx BY NAME'
);
select ok(
  (select plan from reels_plans where name = 'todos') not like '%Seq Scan on feed_posts%',
  '…and is never a Seq Scan on feed_posts'
);
select matches(
  (select plan from reels_plans where name = 'todos_off'),
  'feed_posts_tenant_video_created_idx',
  'REELS-03: the ''Todos'' page (communities OFF, community_id is null) is served by the same index BY NAME'
);
select ok(
  (select plan from reels_plans where name = 'todos_off') not like '%Seq Scan on feed_posts%',
  '…and is never a Seq Scan on feed_posts either'
);

select * from finish();
rollback;
