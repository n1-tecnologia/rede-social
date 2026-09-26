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
-- 4. THE LANES PLAN (05.3-02, REELS-04, D-119, T-05.3-08). On a second volume fixture in tenant V —
--    60 communities (50 active, 10 archived) and 600 posts spread across them, one in ten a video
--    post with a READY video row (the last 60 posts, one per community), on top of the 5,000
--    tenant-wide posts of block 3, `analyze`d — the lanes statement, copied VERBATIM from
--    `listVideoCommunities` (the constant tenant on both sides of the `exists`, the literal
--    `'active'`, feed's `READY_VIDEO_POST`), shows no `Seq Scan on feed_posts` in its TEXT plan.
--    The table also carries 10,000 plain posts of ANOTHER tenant (B), because `feed_posts` is one
--    table for every tenant and a Seq Scan on it reads all of them.
--    MEASURED 2026-09-26 (executor 05.3-02) with rolled-back probes:
--    - WITHOUT the other tenant's rows, V is ~98% of the table, V's 560 video posts sit on every
--      heap page (block 3 interleaves them one in ten), and a Seq Scan costs about what the
--      partial-index bitmap does. The choice then follows index bloat: on a fresh `db:reset` two
--      consecutive runs chose `Bitmap Index Scan on feed_posts_tenant_video_created_idx` (index cost
--      32, then 64, as rolled-back runs left dead index pages) and the THIRD chose `Seq Scan on
--      feed_posts`. Growing V alone (2,000 or 6,000 lane posts) still seq-scanned in that state.
--    - WITH 3,000 / 5,000 / 10,000 other-tenant posts, in that same bloated state, the plan is a
--      Bitmap Index Scan / Bitmap Index Scan / ordered Index Scan on the partial video index. 10,000
--      is kept for the margin.
--    The feed_posts side sits under a Hash Semi Join; communities is a 60-row Seq Scan, which is
--    not what this pins. What the negative does and does not catch, measured on this final fixture
--    by editing the prepared statement in rolled-back probes:
--    - as shipped: `Index Scan using feed_posts_tenant_video_created_idx on feed_posts`;
--    - literal `p.media_kind = 'video'` removed: a per-community `Index Scan using
--      feed_posts_tenant_community_created_idx` (the constant tenant keeps it walkable) — no Seq Scan;
--    - constant `p.tenant_id` predicate removed: still a Bitmap Index Scan on the video index;
--    - correlated `p.tenant_id = c.tenant_id`: the same Index Scan (the planner propagates the
--      constant through the equivalence class), so this fixture does not distinguish it — the
--      constant is kept for the reason 05.2 measured it and for T-05.3-06;
--    - BOTH the tenant predicate and the literal removed: `Seq Scan on feed_posts` over ~15,700
--      rows, and this assertion fails.
--    So the assertion pins that the statement keeps at least one index-leading predicate on
--    feed_posts; it is not a by-name pin (the planner legitimately moves between the two indexes).
--    With the 10,000 other-tenant posts it passed five consecutive runs on a database already
--    bloated by earlier rolled-back runs. The positive control: the statement
--    answers exactly V's 50 ACTIVE communities, and the 10 archived ones, each holding a ready
--    video, are absent (T-05.3-07).
--
-- 5. THE LANES ARE TENANT-SCOPED (T-05.3-06). Tenant A holds one community with a ready video; as
--    the table owner, A's own lanes statement names it (so it is a real lane, not a dead fixture).
--    Under `tests.as_tenant` for V (RLS on): V's lanes statement contains V's own community (the
--    positive control) and never A's; and A's statement, run from V's lane, returns NOTHING — RLS
--    (layer 3) holds even if the constant tenant predicate named another tenant.
--
-- The lanes statement is PREPARED once per tenant constant (`reels_lanes_v`, `reels_lanes_a`), so
-- the EXPLAIN and every assertion run the same text; pgTAP executes a single-word query as a
-- prepared statement. Like its siblings the file ROLLS BACK, so it re-runs identically against a
-- seeded or an empty database, twice in a row, in any order (TENANT-05 ordering).
select plan(20);

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

-- ══ 14-16. THE LANES PLAN ═════════════════════════════════════════════════════════════════════
-- 60 communities in V: 1-50 active, 51-60 archived. Created a month ago, so every one's
-- `last_activity_at` is raised by its own posts (the `app.community_post_stats()` trigger).
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, status, created_at, last_activity_at)
select ('1c00c100-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       '1c000000-0000-4000-8000-000000000001',
       '1c000000-0000-4000-8000-000000000002',
       'Comunidade ' || g, 'comunidade-' || g,
       case when g <= 50 then 'active' else 'archived' end,
       now() - interval '30 days', now() - interval '30 days'
  from generate_series(1, 60) g;

-- 600 posts, ten per community; the last 60 (g > 540) are the video posts, exactly one per community.
insert into public.feed_posts (id, tenant_id, author_user_id, caption, media_kind, community_id, created_at)
select ('1c00f200-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       '1c000000-0000-4000-8000-000000000001',
       '1c000000-0000-4000-8000-000000000002',
       'lane ' || g,
       case when g > 540 then 'video' else 'none' end,
       ('1c00c100-0000-4000-8000-' || lpad(to_hex(((g - 1) % 60) + 1), 12, '0'))::uuid,
       now() - (g || ' minutes')::interval
  from generate_series(1, 600) g;

insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes)
select ('1c00a200-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       '1c000000-0000-4000-8000-000000000001',
       '1c000000-0000-4000-8000-000000000002',
       'video', 'post', 'ready', 'video/mp4', 1024
  from generate_series(541, 600) g;

insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
select '1c000000-0000-4000-8000-000000000001',
       ('1c00f200-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'video',
       ('1c00a200-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'video', 0
  from generate_series(541, 600) g;

-- The OTHER tenants' volume: 10,000 plain posts in tenant B. `feed_posts` is ONE table for every
-- tenant, so V's rows are never most of it in production — and it is exactly what makes a Seq Scan
-- on it wrong (it would read every tenant to answer one). Without this, V is ~98% of the table and a
-- Seq Scan costs the same as V's own rows (measured: see the header, block 4).
insert into public.feed_posts (tenant_id, author_user_id, caption, media_kind, created_at)
select '1c000000-0000-4000-8000-000000000021',
       '1c000000-0000-4000-8000-000000000002',
       'outro tenant ' || g, 'none', now() - (g || ' minutes')::interval
  from generate_series(1, 10000) g;

-- Tenant A (block 5): one community holding one READY video post.
insert into public.communities (id, tenant_id, created_by_user_id, name, slug)
values ('1c00c300-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000011',
        '1c000000-0000-4000-8000-000000000002', 'Comunidade do outro tenant', 'outro-tenant');
insert into public.feed_posts (id, tenant_id, author_user_id, caption, media_kind, community_id)
values ('1c00f300-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000011',
        '1c000000-0000-4000-8000-000000000002', 'video do outro tenant', 'video',
        '1c00c300-0000-4000-8000-000000000001');
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes)
values ('1c00a300-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000011',
        '1c000000-0000-4000-8000-000000000002', 'video', 'post', 'ready', 'video/mp4', 1024);
insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
values ('1c000000-0000-4000-8000-000000000011', '1c00f300-0000-4000-8000-000000000001', 'video',
        '1c00a300-0000-4000-8000-000000000001', 'video', 0);

analyze public.communities;
analyze public.feed_posts;
analyze public.feed_post_media;
analyze public.media_assets;

-- VERBATIM from `listVideoCommunities` (packages/modules/feed/server/service.ts), with
-- `${READY_VIDEO_POST}` expanded and `${ctx.tenantId}` / `${FEED_VIDEO_COMMUNITIES_CAP}` as literals.
prepare reels_lanes_v as
      select c.id, c.name, c.slug
        from public.communities c
       where c.tenant_id = '1c000000-0000-4000-8000-000000000001'::uuid
         and c.deleted_at is null
         and c.status = 'active'
         and exists (
           select 1
             from public.feed_posts p
            where p.tenant_id = '1c000000-0000-4000-8000-000000000001'::uuid
              and p.community_id = c.id
              and p.deleted_at is null
              and p.media_kind = 'video'
              and exists (
                select 1
                  from feed_post_media vm
                  join media_assets va on va.id = vm.media_asset_id
                 where vm.post_id = p.id
                   and vm.kind = 'video'
                   and va.status = 'ready'))
       order by c.last_activity_at desc, c.id desc
       limit 50;

-- The same statement with tenant A as the constant.
prepare reels_lanes_a as
      select c.id, c.name, c.slug
        from public.communities c
       where c.tenant_id = '1c000000-0000-4000-8000-000000000011'::uuid
         and c.deleted_at is null
         and c.status = 'active'
         and exists (
           select 1
             from public.feed_posts p
            where p.tenant_id = '1c000000-0000-4000-8000-000000000011'::uuid
              and p.community_id = c.id
              and p.deleted_at is null
              and p.media_kind = 'video'
              and exists (
                select 1
                  from feed_post_media vm
                  join media_assets va on va.id = vm.media_asset_id
                 where vm.post_id = p.id
                   and vm.kind = 'video'
                   and va.status = 'ready'))
       order by c.last_activity_at desc, c.id desc
       limit 50;

do $$
declare
  r record;
  v_plan text := '';
begin
  for r in execute 'explain execute reels_lanes_v' loop
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  end loop;
  insert into reels_plans values ('lanes', v_plan);
end
$$;

select ok(
  (select plan from reels_plans where name = 'lanes') not like '%Seq Scan on feed_posts%',
  'REELS-04 / T-05.3-08: the lanes statement (constant tenant on both sides, literal ''active'', READY_VIDEO_POST) is never a Seq Scan on feed_posts'
);
select results_eq(
  $$ select count(*)::int from public.communities c
      where c.tenant_id = '1c000000-0000-4000-8000-000000000001' and c.status = 'archived'
        and exists (select 1 from public.feed_posts p
                     join public.feed_post_media vm on vm.post_id = p.id and vm.kind = 'video'
                     join public.media_assets va on va.id = vm.media_asset_id and va.status = 'ready'
                    where p.community_id = c.id) $$,
  ARRAY[10],
  'precondition: each of the 10 archived communities holds a READY video, so their absence below is the status predicate'
);
select set_eq(
  'reels_lanes_v',
  $$ select id, name, slug from public.communities
      where tenant_id = '1c000000-0000-4000-8000-000000000001' and status = 'active' $$,
  'D-119 / T-05.3-07 positive control: the lanes are exactly the 50 ACTIVE communities holding a ready video, never an archived one'
);

-- ══ 17-20. THE LANES ARE TENANT-SCOPED ══════════════════════════════════════════════════════════
select results_eq(
  'reels_lanes_a',
  $$ values ('1c00c300-0000-4000-8000-000000000001'::uuid, 'Comunidade do outro tenant'::text, 'outro-tenant'::text) $$,
  'precondition: in its own tenant, A''s community IS a lane (a ready video, active)'
);

select tests.as_tenant('1c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000002');

select set_has(
  'reels_lanes_v',
  $$ values ('1c00c100-0000-4000-8000-000000000001'::uuid, 'Comunidade 1'::text, 'comunidade-1'::text) $$,
  'positive control (RLS on, as V): V''s own qualifying community is a lane'
);
select set_hasnt(
  'reels_lanes_v',
  $$ values ('1c00c300-0000-4000-8000-000000000001'::uuid, 'Comunidade do outro tenant'::text, 'outro-tenant'::text) $$,
  'T-05.3-06: V''s lanes never name A''s community, although it holds a ready video'
);
select is_empty(
  'reels_lanes_a',
  'T-05.3-06 / layer 3: from V''s lane, even the statement whose constant names A returns nothing (RLS)'
);

reset role;

select * from finish();
rollback;
