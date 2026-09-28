begin;
-- 120-story-highlights.sql — the highlight tables' invariants, executed inside Postgres (05.2-01).
--
-- `story_highlights` / `story_highlight_items` (HIGHLIGHT-01/02/05, D-100..D-103) generalise the
-- community pin. Everything this file asserts is a fact ONLY the database can prove, because the
-- API reaches these rows through one service that could be skipped by a migration, a worker, a
-- psql session or a later plan's hand-written statement. Each block ships its POSITIVE CONTROL in
-- the same block, so a fixture that failed globally, or a constraint that refused everything,
-- could not make a refusal pass.
--
-- Constraint and index names are asserted VERBATIM — as the full Postgres error message in every
-- `throws_ok`, and by name in the catalogue block — so a rename breaks this file instead of
-- silently leaving a test that proves some other constraint.
--
-- 1. THE CATALOGUE. The three indexes and the four named constraints the service relies on exist
--    under their exact names: `story_highlights_tenant_place_idx` (the row read and the create's
--    place lock), `story_highlight_items_uq` (THE idempotency arbiter), and
--    `story_highlight_items_tenant_story_idx` (tenant first, "how many highlights is this story in").
--
-- 2. `story_highlights_community_fk` IS REAL. It is hand-written SQL in `*_story_highlights.sql`
--    because a drizzle `.references()` would need the `module -> module` package edge `turbo
--    boundaries` denies (MOD-02). A random `community_id` is refused 23503; the real community and
--    a NULL (Início) are both accepted.
--
-- 3. `story_highlights_title_chk`: 1..15 characters and already trimmed. 16 characters, an
--    untrimmed title and an empty one are each refused 23514; exactly 15 is accepted. The API trims
--    before it writes; this is the backstop for everything that does not go through the API.
--
-- 4. `story_highlights_position_chk` refuses a negative position; 0 is accepted (every highlight in
--    this fixture sits at 0 or above).
--
-- 5. `story_highlights_cover_chk`: an uploaded cover OR a chosen story, never both. Both set is
--    refused 23514; a chosen story alone is accepted.
--
-- 6. THE ARBITER (D-100). `story_highlight_items_uq` is unique on `(highlight_id, story_id)` ONLY:
--    a plain duplicate is refused 23505, the service's `on conflict … do nothing` leaves exactly one
--    row, and the SAME story in a SECOND highlight is accepted — the many-to-many join.
--
-- 7. CASCADES. Deleting a highlight removes its items and the STORY ROW SURVIVES (a highlight is an
--    editorial pointer, never a copy or a move). Deleting a community removes its highlights and
--    their items — while the Início highlight of the same tenant and tenant B's structurally
--    identical community highlight both survive. Deleting a chosen cover story nulls
--    `cover_story_id` (`on delete set null`) rather than breaking the row.
--
-- 8. THE EXPIRY OVERRIDE (STORY-04 re-delivered, docblock item 6), under a clock this transaction
--    controls: `now()` is the TRANSACTION timestamp, so a story published 30 hours ago is expired
--    for every assertion below without sleeping. The ITEMS READ — `getHighlight`'s statement shape,
--    which carries NO expiry predicate — returns it (oldest first by publish time, D-103), while the
--    STRIP predicate refuses the same row in the same transaction. The two surfaces disagree on
--    purpose; a future liveness predicate on the items read turns the first assertion red.
--
-- 9. `story_views` (05.2-10: HIGHLIGHT-06, D-105) — the caller's server-side seen state:
--    - `story_views_uq` is `(tenant_id, user_id, story_id)`, IN THAT ORDER (the catalogue);
--    - it is THE ARBITER: a plain duplicate is refused 23505 and the service's `on conflict … do
--      nothing` leaves exactly one row;
--    - a view for a user that does not exist is refused 23503 (positive control: a real user);
--    - hard-deleting a story removes its views, and another tenant's view survives;
--    - THE RING'S PLAN: on a volume fixture (400 stories, 20,000 views over 50 users, analyzed), the
--      strip statement with the projection's CONSTANT-tenant `exists` names
--      `stories_tenant_expires_idx` AND `story_views_uq`, and has NO `Seq Scan on story_views`. The
--      plan is captured in TEXT format, where that phrase is literally what a sequential scan prints
--      (the JSON format splits it into two keys, which would make a `like` check vacuous).
--
-- 10. THE PIN MODEL IS RETIRED (05.2-11: HIGHLIGHT-05, D-116, roadmap criteria 4 and 5):
--    - `story_community_pins` no longer exists — migration file 2 dropped it after file 1's guarded
--      backfill copied every pin into a `Destaques` highlight;
--    - STORY-04 RE-DELIVERED ON THE SEED: the seeded community `Destaques` still reaches the seeded
--      EXPIRED story through the items read (no expiry predicate). CI runs this file on a reset,
--      UNSEEDED database (`db reset` → `test db` → `db:seed`), so the assertion SKIPS there with a
--      reason rather than failing — the plan count is identical either way.
--
-- Like its siblings this file ROLLS BACK, so it re-runs identically against a seeded or an empty
-- database, twice in a row, in any order.
select plan(41);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
-- Two tenants, each with one user, one community and one ready image asset. Tenant A also gets an
-- ACTIVE story (published an hour ago) and an EXPIRED one (published 30 hours ago); tenant B gets
-- one story so its highlight has an item to lose if a cascade ever crossed tenants.
select tests.tenant('pgtap-hl-a', 'Destaques A', '12000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-hl-b', 'Destaques B', '12000000-0000-4000-8000-000000000011');
select tests.auth_user('highlights-a@120.local', '12000000-0000-4000-8000-000000000002');
select tests.auth_user('highlights-b@120.local', '12000000-0000-4000-8000-000000000012');
select tests.member('12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('12000000-0000-4000-8000-000000000011', '12000000-0000-4000-8000-000000000012', 'admin_tenant');

insert into public.communities (id, tenant_id, created_by_user_id, name, slug, description) values
  ('12000000-0000-4000-8000-0000000000c1', '12000000-0000-4000-8000-000000000001',
   '12000000-0000-4000-8000-000000000002', 'Avisos', 'avisos', ''),
  ('12000000-0000-4000-8000-0000000000c2', '12000000-0000-4000-8000-000000000011',
   '12000000-0000-4000-8000-000000000012', 'Avisos', 'avisos', '');

insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  ('12000000-0000-4000-8000-0000000000a1', '12000000-0000-4000-8000-000000000001',
   '12000000-0000-4000-8000-000000000002', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  ('12000000-0000-4000-8000-0000000000a2', '12000000-0000-4000-8000-000000000011',
   '12000000-0000-4000-8000-000000000012', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}');

insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind,
                            caption, published_at, expires_at) values
  ('12000000-0000-4000-8000-0000000000e1', '12000000-0000-4000-8000-000000000001',
   '12000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-0000000000a1', 'image',
   'ativa', now() - interval '1 hour', now() + interval '23 hours'),
  ('12000000-0000-4000-8000-0000000000e2', '12000000-0000-4000-8000-000000000001',
   '12000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-0000000000a1', 'image',
   'expirada', now() - interval '30 hours', now() - interval '6 hours'),
  ('12000000-0000-4000-8000-0000000000e3', '12000000-0000-4000-8000-000000000011',
   '12000000-0000-4000-8000-000000000012', '12000000-0000-4000-8000-0000000000a2', 'image',
   'ativa', now() - interval '1 hour', now() + interval '23 hours');

-- ══ 1-2. THE CATALOGUE ══════════════════════════════════════════════════════════════════════════
select results_eq(
  $$ select indexname::text collate "default" from pg_indexes
      where schemaname = 'public'
        and indexname in ('story_highlights_tenant_place_idx', 'story_highlight_items_uq',
                          'story_highlight_items_tenant_story_idx')
      order by indexname $$,
  ARRAY['story_highlight_items_tenant_story_idx', 'story_highlight_items_uq',
        'story_highlights_tenant_place_idx'],
  'the three highlight indexes exist under their exact names'
);
select results_eq(
  $$ select conname::text collate "default" from pg_constraint
      where conrelid = 'public.story_highlights'::regclass
        and conname in ('story_highlights_community_fk', 'story_highlights_title_chk',
                        'story_highlights_position_chk', 'story_highlights_cover_chk')
      order by conname $$,
  ARRAY['story_highlights_community_fk', 'story_highlights_cover_chk',
        'story_highlights_position_chk', 'story_highlights_title_chk'],
  'the hand-written community FK and the three CHECKs exist under their exact names'
);

-- ══ 3-5. story_highlights_community_fk IS REAL ══════════════════════════════════════════════════
select throws_ok(
  $$ insert into public.story_highlights (tenant_id, community_id, title, position, created_by_user_id)
     values ('12000000-0000-4000-8000-000000000001', gen_random_uuid(), 'Solta', 0,
             '12000000-0000-4000-8000-000000000002') $$,
  '23503',
  'insert or update on table "story_highlights" violates foreign key constraint "story_highlights_community_fk"',
  'story_highlights_community_fk refuses a community_id that names no community'
);
-- Positive controls: the tenant's real community, and NULL (Início), are both accepted. These two
-- rows are the fixture every later block uses.
select lives_ok(
  $$ insert into public.story_highlights (id, tenant_id, community_id, title, position, created_by_user_id)
     values ('12000000-0000-4000-8000-0000000000f2', '12000000-0000-4000-8000-000000000001',
             '12000000-0000-4000-8000-0000000000c1', 'Destaques', 0,
             '12000000-0000-4000-8000-000000000002') $$,
  'positive control: a highlight on the tenant''s REAL community is accepted'
);
select lives_ok(
  $$ insert into public.story_highlights (id, tenant_id, community_id, title, position, created_by_user_id)
     values ('12000000-0000-4000-8000-0000000000f1', '12000000-0000-4000-8000-000000000001',
             null, 'Bastidores', 0, '12000000-0000-4000-8000-000000000002') $$,
  'positive control: community_id NULL is Início, and a NULL passes the foreign key by definition'
);

-- Tenant B's structurally identical community highlight — the cascade block's cross-tenant control.
insert into public.story_highlights (id, tenant_id, community_id, title, position, created_by_user_id)
values ('12000000-0000-4000-8000-0000000000f3', '12000000-0000-4000-8000-000000000011',
        '12000000-0000-4000-8000-0000000000c2', 'Destaques', 0, '12000000-0000-4000-8000-000000000012');

-- ══ 6-9. story_highlights_title_chk ═════════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into public.story_highlights (tenant_id, community_id, title, position, created_by_user_id)
     values ('12000000-0000-4000-8000-000000000001', null, repeat('a', 16), 1,
             '12000000-0000-4000-8000-000000000002') $$,
  '23514',
  'new row for relation "story_highlights" violates check constraint "story_highlights_title_chk"',
  'story_highlights_title_chk refuses a 16-character title'
);
select throws_ok(
  $$ insert into public.story_highlights (tenant_id, community_id, title, position, created_by_user_id)
     values ('12000000-0000-4000-8000-000000000001', null, ' Aulas', 1,
             '12000000-0000-4000-8000-000000000002') $$,
  '23514',
  'new row for relation "story_highlights" violates check constraint "story_highlights_title_chk"',
  'story_highlights_title_chk refuses an UNTRIMMED title — the API trims, the database insists'
);
select throws_ok(
  $$ insert into public.story_highlights (tenant_id, community_id, title, position, created_by_user_id)
     values ('12000000-0000-4000-8000-000000000001', null, '', 1,
             '12000000-0000-4000-8000-000000000002') $$,
  '23514',
  'new row for relation "story_highlights" violates check constraint "story_highlights_title_chk"',
  'story_highlights_title_chk refuses an empty title'
);
select lives_ok(
  $$ insert into public.story_highlights (tenant_id, community_id, title, position, created_by_user_id)
     values ('12000000-0000-4000-8000-000000000001', null, repeat('a', 15), 1,
             '12000000-0000-4000-8000-000000000002') $$,
  'positive control: exactly 15 characters, trimmed, is accepted'
);

-- ══ 10-11. story_highlights_position_chk ════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into public.story_highlights (tenant_id, community_id, title, position, created_by_user_id)
     values ('12000000-0000-4000-8000-000000000001', null, 'Negativa', -1,
             '12000000-0000-4000-8000-000000000002') $$,
  '23514',
  'new row for relation "story_highlights" violates check constraint "story_highlights_position_chk"',
  'story_highlights_position_chk refuses a negative position'
);
select lives_ok(
  $$ insert into public.story_highlights (tenant_id, community_id, title, position, created_by_user_id)
     values ('12000000-0000-4000-8000-000000000001', null, 'Zero', 0,
             '12000000-0000-4000-8000-000000000002') $$,
  'positive control: position 0 is accepted, and there is NO unique index on it (R-D-C) — Bastidores already sits at 0'
);

-- ══ 12-13. story_highlights_cover_chk ═══════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into public.story_highlights (tenant_id, community_id, title, position, created_by_user_id,
                                          cover_story_id, cover_asset_id)
     values ('12000000-0000-4000-8000-000000000001', null, 'Duas capas', 2,
             '12000000-0000-4000-8000-000000000002',
             '12000000-0000-4000-8000-0000000000e1', '12000000-0000-4000-8000-0000000000a1') $$,
  '23514',
  'new row for relation "story_highlights" violates check constraint "story_highlights_cover_chk"',
  'story_highlights_cover_chk refuses an uploaded cover AND a chosen story on the same row'
);
select lives_ok(
  $$ insert into public.story_highlights (id, tenant_id, community_id, title, position, created_by_user_id,
                                          cover_story_id)
     values ('12000000-0000-4000-8000-0000000000f4', '12000000-0000-4000-8000-000000000001', null,
             'Uma capa', 2, '12000000-0000-4000-8000-000000000002',
             '12000000-0000-4000-8000-0000000000e1') $$,
  'positive control: a chosen story alone is accepted'
);

-- ══ 14-17. THE ARBITER (D-100) ══════════════════════════════════════════════════════════════════
insert into public.story_highlight_items (id, tenant_id, highlight_id, story_id, added_by_user_id) values
  ('12000000-0000-4000-8000-0000000000b1', '12000000-0000-4000-8000-000000000001',
   '12000000-0000-4000-8000-0000000000f1', '12000000-0000-4000-8000-0000000000e2',
   '12000000-0000-4000-8000-000000000002'),
  ('12000000-0000-4000-8000-0000000000b2', '12000000-0000-4000-8000-000000000001',
   '12000000-0000-4000-8000-0000000000f1', '12000000-0000-4000-8000-0000000000e1',
   '12000000-0000-4000-8000-000000000002'),
  ('12000000-0000-4000-8000-0000000000b4', '12000000-0000-4000-8000-000000000011',
   '12000000-0000-4000-8000-0000000000f3', '12000000-0000-4000-8000-0000000000e3',
   '12000000-0000-4000-8000-000000000012');

select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-0000000000f1',
             '12000000-0000-4000-8000-0000000000e2', '12000000-0000-4000-8000-000000000002') $$,
  '23505',
  'duplicate key value violates unique constraint "story_highlight_items_uq"',
  'story_highlight_items_uq refuses a second row for the same (highlight, story) pair'
);
-- The statement the SERVICE issues (`insertHighlightItem`): the arbiter absorbs the repeat.
insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
values ('12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-0000000000f1',
        '12000000-0000-4000-8000-0000000000e2', '12000000-0000-4000-8000-000000000002')
on conflict (highlight_id, story_id) do nothing;
select results_eq(
  $$ select count(*)::int from public.story_highlight_items
      where highlight_id = '12000000-0000-4000-8000-0000000000f1'
        and story_id = '12000000-0000-4000-8000-0000000000e2' $$,
  ARRAY[1],
  '…so a repeat add through `on conflict (highlight_id, story_id) do nothing` leaves exactly one row'
);
-- D-100's many-to-many half: the SAME story in a SECOND highlight is a new, legal row.
select lives_ok(
  $$ insert into public.story_highlight_items (id, tenant_id, highlight_id, story_id, added_by_user_id)
     values ('12000000-0000-4000-8000-0000000000b3', '12000000-0000-4000-8000-000000000001',
             '12000000-0000-4000-8000-0000000000f2', '12000000-0000-4000-8000-0000000000e2',
             '12000000-0000-4000-8000-000000000002') $$,
  'positive control (D-100): the same story in a SECOND highlight is accepted — the arbiter is the pair, not the story'
);
select results_eq(
  $$ select count(*)::int from public.story_highlight_items
      where story_id = '12000000-0000-4000-8000-0000000000e2' $$,
  ARRAY[2],
  'one story now sits in two highlights: two rows, never merged'
);

-- ══ 18-21. THE EXPIRY OVERRIDE, under this transaction's clock ══════════════════════════════════
select results_eq(
  $$ select (expires_at < now()) from public.stories
      where id = '12000000-0000-4000-8000-0000000000e2' $$,
  ARRAY[true],
  'precondition: the story in Bastidores really is expired under this transaction''s now()'
);
-- `getHighlight`'s items statement for a MEMBER, verbatim in shape — read it for what is NOT in it.
select results_eq(
  $$ select s.id::text
       from public.story_highlight_items i
       join public.stories s on s.id = i.story_id and s.tenant_id = i.tenant_id
       join public.media_assets a on a.id = s.media_asset_id
      where i.highlight_id = '12000000-0000-4000-8000-0000000000f1'
        and i.tenant_id = '12000000-0000-4000-8000-000000000001'
        and s.deleted_at is null and a.status = 'ready'
      order by s.published_at, s.id $$,
  ARRAY['12000000-0000-4000-8000-0000000000e2', '12000000-0000-4000-8000-0000000000e1'],
  'STORY-04 / D-103: the items read returns the EXPIRED story — no expiry predicate — oldest first by PUBLISH time'
);
select is_empty(
  $$ select s.id from public.stories s
      where s.tenant_id = '12000000-0000-4000-8000-000000000001'
        and s.deleted_at is null
        and s.expires_at > now()
        and s.id = '12000000-0000-4000-8000-0000000000e2' $$,
  '…while the STRIP predicate refuses the same row under the same now() — the two surfaces disagree DELIBERATELY'
);
select results_eq(
  $$ select s.id::text from public.stories s
      where s.tenant_id = '12000000-0000-4000-8000-000000000001'
        and s.deleted_at is null
        and s.expires_at > now()
        and s.id = '12000000-0000-4000-8000-0000000000e1' $$,
  ARRAY['12000000-0000-4000-8000-0000000000e1'],
  'positive control: the strip predicate still returns the ACTIVE story — it is not refusing everything'
);

-- ══ 22-23. deleting a HIGHLIGHT removes its items; the STORY survives ═══════════════════════════
delete from public.story_highlights where id = '12000000-0000-4000-8000-0000000000f1';
select is_empty(
  $$ select id from public.story_highlight_items
      where highlight_id = '12000000-0000-4000-8000-0000000000f1' $$,
  'deleting a highlight removes its items (story_highlight_items cascades on the highlight)'
);
select results_eq(
  $$ select count(*)::int from public.stories
      where id in ('12000000-0000-4000-8000-0000000000e1', '12000000-0000-4000-8000-0000000000e2')
        and deleted_at is null $$,
  ARRAY[2],
  '…while BOTH story rows survive — a highlight is an editorial pointer, never a copy or a move'
);

-- ══ 24-26. deleting a COMMUNITY removes its highlights and their items ══════════════════════════
delete from public.communities where id = '12000000-0000-4000-8000-0000000000c1';
select is_empty(
  $$ select h.id from public.story_highlights h
      where h.id = '12000000-0000-4000-8000-0000000000f2'
     union all
     select i.id from public.story_highlight_items i
      where i.highlight_id = '12000000-0000-4000-8000-0000000000f2' $$,
  'deleting a community removes its highlights AND their items (story_highlights_community_fk cascades)'
);
select results_eq(
  $$ select count(*)::int from public.story_highlights
      where tenant_id = '12000000-0000-4000-8000-000000000001' and community_id is null $$,
  ARRAY[3],
  'positive control: the same tenant''s Início highlights are untouched by the community delete'
);
select results_eq(
  $$ select (select count(*)::int from public.story_highlights
              where id = '12000000-0000-4000-8000-0000000000f3'),
            (select count(*)::int from public.story_highlight_items
              where highlight_id = '12000000-0000-4000-8000-0000000000f3') $$,
  $$ values (1, 1) $$,
  'positive control: tenant B''s structurally identical community highlight keeps its row and its item'
);

-- ══ 27-28. deleting a chosen COVER story nulls the pointer, never breaks the row ════════════════
delete from public.stories where id = '12000000-0000-4000-8000-0000000000e1';
select results_eq(
  $$ select cover_story_id is null from public.story_highlights
      where id = '12000000-0000-4000-8000-0000000000f4' $$,
  ARRAY[true],
  'a hard-deleted cover story nulls cover_story_id (on delete set null) — the read-time rule falls back'
);
select results_eq(
  $$ select count(*)::int from public.story_highlight_items
      where story_id = '12000000-0000-4000-8000-0000000000e1' $$,
  ARRAY[0],
  '…and a hard-deleted story leaves no item behind (story_highlight_items cascades on the story)'
);

-- ══ 29. story_views: the catalogue — the arbiter's column ORDER is the measured one ══════════════
select matches(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'story_views_uq'),
  'CREATE UNIQUE INDEX story_views_uq ON public\.story_views USING btree \(tenant_id, user_id, story_id\)',
  'story_views_uq exists, unique, on (tenant_id, user_id, story_id) in that order (tenant first, then the ring''s probe)'
);

-- ══ 30-32. story_views_uq IS THE ARBITER ══════════════════════════════════════════════════════════
-- The expired story e2 is the one left in tenant A: a view of an EXPIRED story is recorded (R-D-I).
select lives_ok(
  $$ insert into public.story_views (tenant_id, user_id, story_id)
     values ('12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002',
             '12000000-0000-4000-8000-0000000000e2') $$,
  'a view of an EXPIRED story is accepted (expiry gates the strip, never a view)'
);
select throws_ok(
  $$ insert into public.story_views (tenant_id, user_id, story_id)
     values ('12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002',
             '12000000-0000-4000-8000-0000000000e2') $$,
  '23505',
  'duplicate key value violates unique constraint "story_views_uq"',
  'story_views_uq refuses a second row for the same (tenant, user, story)'
);
insert into public.story_views (tenant_id, user_id, story_id)
values ('12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002',
        '12000000-0000-4000-8000-0000000000e2')
on conflict (tenant_id, user_id, story_id) do nothing;
select results_eq(
  $$ select count(*)::int from public.story_views
      where user_id = '12000000-0000-4000-8000-000000000002'
        and story_id = '12000000-0000-4000-8000-0000000000e2' $$,
  ARRAY[1],
  'the service''s on conflict (tenant_id, user_id, story_id) do nothing leaves exactly ONE row'
);

-- ══ 33-34. the user is a real FK ═════════════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into public.story_views (tenant_id, user_id, story_id)
     values ('12000000-0000-4000-8000-000000000001', gen_random_uuid(),
             '12000000-0000-4000-8000-0000000000e2') $$,
  '23503',
  'insert or update on table "story_views" violates foreign key constraint "story_views_user_id_users_id_fk"',
  'a view for a user that does not exist is refused by story_views_user_id_users_id_fk'
);
select lives_ok(
  $$ insert into public.story_views (tenant_id, user_id, story_id)
     values ('12000000-0000-4000-8000-000000000011', '12000000-0000-4000-8000-000000000012',
             '12000000-0000-4000-8000-0000000000e3') $$,
  'positive control: tenant B''s REAL user viewing tenant B''s story is accepted'
);

-- ══ 35-36. deleting a story removes its views — and only its views ══════════════════════════════
delete from public.stories where id = '12000000-0000-4000-8000-0000000000e2';
select is_empty(
  $$ select id from public.story_views where story_id = '12000000-0000-4000-8000-0000000000e2' $$,
  'hard-deleting a story removes its views (story_views cascades on the story)'
);
select results_eq(
  $$ select count(*)::int from public.story_views
      where tenant_id = '12000000-0000-4000-8000-000000000011' $$,
  ARRAY[1],
  'positive control: tenant B''s view of its own story survives tenant A''s delete'
);

-- ══ 37-39. THE RING'S PLAN: the constant-tenant exists rides story_views_uq ═════════════════════
-- Volume, or the planner proves nothing: 50 users, 400 live stories of tenant A (windows spread so
-- the order is the index's to deliver), and every user has seen every story — 20,000 views. Then
-- `analyze` both tables, as the seed does for the feed tables.
select tests.auth_user(
  'views-' || g || '@120.local',
  ('1200e000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid
) from generate_series(1, 50) g;

insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind,
                            caption, published_at, expires_at)
select ('12005000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       '12000000-0000-4000-8000-000000000001',
       '12000000-0000-4000-8000-000000000002',
       '12000000-0000-4000-8000-0000000000a1',
       'image',
       'volume ' || g,
       now() - (g || ' minutes')::interval,
       now() + interval '24 hours' - (g || ' minutes')::interval
  from generate_series(1, 400) g;

insert into public.story_views (tenant_id, user_id, story_id)
select '12000000-0000-4000-8000-000000000001',
       ('1200e000-0000-4000-8000-' || lpad(to_hex(u), 12, '0'))::uuid,
       ('12005000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid
  from generate_series(1, 50) u
 cross join generate_series(1, 400) g;

analyze public.stories;
analyze public.story_views;

create temporary table view_plans (name text primary key, plan text);

do $$
declare
  r record;
  v_plan text := '';
begin
  -- `storyProjection`'s viewer_seen column over the strip's own predicate and order, verbatim in
  -- shape: the tenant predicate on the views is a CONSTANT (never the story's tenant column).
  for r in execute
    'explain select s.id,
            exists (select 1 from public.story_views v
                     where v.tenant_id = ''12000000-0000-4000-8000-000000000001''
                       and v.user_id = ''1200e000-0000-4000-8000-000000000001''
                       and v.story_id = s.id) as viewer_seen
       from public.stories s
      where s.tenant_id = ''12000000-0000-4000-8000-000000000001''
        and s.deleted_at is null and s.expires_at > now()
      order by s.expires_at desc, s.id desc limit 26'
  loop
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  end loop;
  insert into view_plans values ('ring', v_plan);
end
$$;

select matches(
  (select plan from view_plans where name = 'ring'),
  'stories_tenant_expires_idx',
  'the strip with viewer_seen still ranges and orders on stories_tenant_expires_idx BY NAME'
);
select matches(
  (select plan from view_plans where name = 'ring'),
  'story_views_uq',
  'the viewer_seen subplan probes story_views_uq BY NAME (constant tenant + user, then story)'
);
select ok(
  (select plan from view_plans where name = 'ring') not like '%Seq Scan on story_views%',
  'the viewer_seen subplan is NEVER a Seq Scan on story_views (the correlated form measured as one)'
);

-- ══ 40-41. THE PIN MODEL IS RETIRED; the curated expired story outlives it ══════════════════════
select hasnt_table(
  'public', 'story_community_pins',
  'HIGHLIGHT-05 / D-116: the pin table is gone — a highlight item is the one representation of a curated story'
);
-- The seeded demo community `Destaques` (scripts/seed.ts `SEED_HIGHLIGHT_IDS['rede-demo'].community`)
-- and the seeded EXPIRED story (`SEED_STORY_IDS['rede-demo'][3]`, published 30 hours ago), read
-- through `getHighlight`'s MEMBER items statement verbatim in shape — no expiry predicate.
select case
  when exists (select 1 from public.story_highlights
                where id = '0d000000-0000-4000-8000-0000000002a3')
  then ok(
    exists (
      select 1
        from public.story_highlight_items i
        join public.stories s on s.id = i.story_id and s.tenant_id = i.tenant_id
        join public.media_assets a on a.id = s.media_asset_id
       where i.highlight_id = '0d000000-0000-4000-8000-0000000002a3'
         and i.tenant_id = s.tenant_id
         and s.id = '0d000000-0000-4000-8000-0000000000d4'
         and s.expires_at < now()
         and s.deleted_at is null and a.status = 'ready'),
    'STORY-04 re-delivered: the seeded Destaques still reaches the seeded EXPIRED story through the items read'
  )
  else skip('no seed loaded (CI runs pgTAP before db:seed) — the post-seed reachability check needs it', 1)
end;

select * from finish();
rollback;
