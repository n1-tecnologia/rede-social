begin;
-- 227-second-covers.sql — Phase 12.3 (NOVF-02, NOVF-03, NOVF-04, NOVF-11; D-696, D-699, D-700, OQ-1; T-12.3-02, T-12.3-01):
-- the five optional second-cover columns of migration `*_second_covers.sql` and the isolation of the four tables that hold them,
-- executed inside Postgres.
--
--  1. SHAPE: each of the five columns exists, is `uuid`, nullable, has no default and a foreign key to `media_assets(id)`; the
--     cover columns that already existed stay; the policies of the four tables are exactly the ones the schema declares.
--  2. NO BACKFILL: a row inserted without the new columns reads NULL in all five (D-69 stays true, D-696 expand-only).
--  3. THE POSITIVE CONTROL: `admin_tenant` of tenant A sets a second cover on A's own track, course, module (both columns) and
--     event, a member of A reads it back.
--  4. THE NEGATIVES, each beside that positive control: a member and a support member of A update ZERO rows of A's tracks,
--     courses and modules; the admin of tenant B updates ZERO rows of A's five columns and selects NONE of them; A's values are
--     still intact afterwards (read as the migration role).
--  5. THE CLEAR: the admin of A writes NULL back on all five (the positive control closes the loop).
--
-- `events` rides the standard `events_tenant_isolation` policy (`for all`, tenant only): who may write an event is
-- `requirePermission('events.event.manage')` in the service, not a database policy, so this file asserts no member or support
-- refusal on the poster column, only the cross-tenant ones. The five foreign keys are plain single-column keys like the existing
-- cover columns: the tenant of the asset is checked by the services (plans 12.3-04 to 06) and this file does NOT claim the
-- database refuses a foreign asset id (T-12.3-01, accepted).
--
-- Fixture ids use the `27000000-0000-4000-8000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(64);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
-- A the tenant under test, B the other tenant. A: admin, support, member. B: admin.
select tests.tenant('pgtap-sc-a', 'Sc A', '27000000-0000-4000-8000-010000000001');
select tests.tenant('pgtap-sc-b', 'Sc B', '27000000-0000-4000-8000-010000000002');
select tests.auth_user('admin@sc-a.local', '27000000-0000-4000-8000-020000000001');
select tests.auth_user('support@sc-a.local', '27000000-0000-4000-8000-020000000002');
select tests.auth_user('member@sc-a.local', '27000000-0000-4000-8000-020000000003');
select tests.auth_user('admin@sc-b.local', '27000000-0000-4000-8000-020000000004');
insert into public.memberships (tenant_id, user_id, role, status) values
  ('27000000-0000-4000-8000-010000000001', '27000000-0000-4000-8000-020000000001', 'admin_tenant', 'active'),
  ('27000000-0000-4000-8000-010000000001', '27000000-0000-4000-8000-020000000002', 'support_tenant', 'active'),
  ('27000000-0000-4000-8000-010000000001', '27000000-0000-4000-8000-020000000003', 'member', 'active'),
  ('27000000-0000-4000-8000-010000000002', '27000000-0000-4000-8000-020000000004', 'admin_tenant', 'active');
-- One ready cover image per tenant.
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes) values
  ('27000000-0000-4000-8000-040000000001', '27000000-0000-4000-8000-010000000001', '27000000-0000-4000-8000-020000000001', 'image', 'cover', 'ready', 'image/jpeg', 1024),
  ('27000000-0000-4000-8000-040000000002', '27000000-0000-4000-8000-010000000002', '27000000-0000-4000-8000-020000000004', 'image', 'cover', 'ready', 'image/jpeg', 1024);
-- One track, one PUBLISHED course (a member reads it), one module and one event per tenant. None of them names a second cover.
insert into public.course_tracks (id, tenant_id, title) values
  ('27000000-0000-4000-8000-060000000001', '27000000-0000-4000-8000-010000000001', 'Trilha A'), ('27000000-0000-4000-8000-060000000002', '27000000-0000-4000-8000-010000000002', 'Trilha B');
insert into public.courses (id, tenant_id, created_by_user_id, title, instructor_name, status, published_at) values
  ('27000000-0000-4000-8000-070000000001', '27000000-0000-4000-8000-010000000001', '27000000-0000-4000-8000-020000000001', 'Curso A', 'x', 'published', now()),
  ('27000000-0000-4000-8000-070000000002', '27000000-0000-4000-8000-010000000002', '27000000-0000-4000-8000-020000000004', 'Curso B', 'x', 'published', now());
insert into public.course_modules (id, tenant_id, course_id, title, position) values
  ('27000000-0000-4000-8000-080000000001', '27000000-0000-4000-8000-010000000001', '27000000-0000-4000-8000-070000000001', 'Modulo A', 1), ('27000000-0000-4000-8000-080000000002', '27000000-0000-4000-8000-010000000002', '27000000-0000-4000-8000-070000000002', 'Modulo B', 1);
insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name, address, starts_at, ends_at) values
  ('27000000-0000-4000-8000-090000000001', '27000000-0000-4000-8000-010000000001', '27000000-0000-4000-8000-020000000001', 'Evento A', 'in_person', 'Sede', 'Rua A, 1', now() + interval '1 day', now() + interval '1 day 2 hours'),
  ('27000000-0000-4000-8000-090000000002', '27000000-0000-4000-8000-010000000002', '27000000-0000-4000-8000-020000000004', 'Evento B', 'in_person', 'Sede', 'Rua B, 1', now() + interval '1 day', now() + interval '1 day 2 hours');
insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code) values
  ('27000000-0000-4000-8000-090000000001', '27000000-0000-4000-8000-010000000001', 'in_person', 'K7QM'), ('27000000-0000-4000-8000-090000000002', '27000000-0000-4000-8000-010000000002', 'in_person', 'K7QM');


-- ── (1) SHAPE ─────────────────────────────────────────────────────────────────────────────────
select col_type_is('public', 'course_tracks', 'top_cover_asset_id', 'uuid', 'track top cover: course_tracks.top_cover_asset_id is uuid');
select col_is_null('public', 'course_tracks', 'top_cover_asset_id', 'track top cover: course_tracks.top_cover_asset_id is nullable');
select col_hasnt_default('public', 'course_tracks', 'top_cover_asset_id', 'track top cover: course_tracks.top_cover_asset_id has no default (nothing is backfilled)');
select fk_ok('public', 'course_tracks', 'top_cover_asset_id', 'public', 'media_assets', 'id', 'track top cover: course_tracks.top_cover_asset_id references media_assets(id)');
select col_type_is('public', 'courses', 'top_cover_asset_id', 'uuid', 'course top cover: courses.top_cover_asset_id is uuid');
select col_is_null('public', 'courses', 'top_cover_asset_id', 'course top cover: courses.top_cover_asset_id is nullable');
select col_hasnt_default('public', 'courses', 'top_cover_asset_id', 'course top cover: courses.top_cover_asset_id has no default (nothing is backfilled)');
select fk_ok('public', 'courses', 'top_cover_asset_id', 'public', 'media_assets', 'id', 'course top cover: courses.top_cover_asset_id references media_assets(id)');
select col_type_is('public', 'course_modules', 'cover_asset_id', 'uuid', 'module card cover: course_modules.cover_asset_id is uuid');
select col_is_null('public', 'course_modules', 'cover_asset_id', 'module card cover: course_modules.cover_asset_id is nullable');
select col_hasnt_default('public', 'course_modules', 'cover_asset_id', 'module card cover: course_modules.cover_asset_id has no default (nothing is backfilled)');
select fk_ok('public', 'course_modules', 'cover_asset_id', 'public', 'media_assets', 'id', 'module card cover: course_modules.cover_asset_id references media_assets(id)');
select col_type_is('public', 'course_modules', 'top_cover_asset_id', 'uuid', 'module top cover: course_modules.top_cover_asset_id is uuid');
select col_is_null('public', 'course_modules', 'top_cover_asset_id', 'module top cover: course_modules.top_cover_asset_id is nullable');
select col_hasnt_default('public', 'course_modules', 'top_cover_asset_id', 'module top cover: course_modules.top_cover_asset_id has no default (nothing is backfilled)');
select fk_ok('public', 'course_modules', 'top_cover_asset_id', 'public', 'media_assets', 'id', 'module top cover: course_modules.top_cover_asset_id references media_assets(id)');
select col_type_is('public', 'events', 'poster_asset_id', 'uuid', 'event poster: events.poster_asset_id is uuid');
select col_is_null('public', 'events', 'poster_asset_id', 'event poster: events.poster_asset_id is nullable');
select col_hasnt_default('public', 'events', 'poster_asset_id', 'event poster: events.poster_asset_id has no default (nothing is backfilled)');
select fk_ok('public', 'events', 'poster_asset_id', 'public', 'media_assets', 'id', 'event poster: events.poster_asset_id references media_assets(id)');
select results_eq(
  $$ select (table_name::text || '.' || column_name::text) collate "default" from information_schema.columns
      where table_schema = 'public'
        and table_name in ('courses', 'course_modules', 'course_tracks', 'events')
        and column_name in ('cover_asset_id', 'top_cover_asset_id', 'poster_asset_id')
      order by 1 $$,
  $$ values ('course_modules.cover_asset_id'), ('course_modules.top_cover_asset_id'), ('course_tracks.cover_asset_id'),
            ('course_tracks.top_cover_asset_id'), ('courses.cover_asset_id'), ('courses.top_cover_asset_id'),
            ('events.cover_asset_id'), ('events.poster_asset_id') $$,
  'the four tables hold exactly the old card covers plus the five new columns (nothing dropped, nothing else added)');
select results_eq(
  $$ select (tablename::text || '=' || count(*)::text) collate "default" from pg_policies
      where schemaname = 'public' and tablename in ('courses', 'course_modules', 'course_tracks', 'events')
      group by tablename order by 1 $$,
  $$ values ('course_modules=4'), ('course_tracks=4'), ('courses=4'), ('events=1') $$,
  'the policies of the four tables are the ones the schema declares (this migration touched none)');

-- ── (2) NO BACKFILL ───────────────────────────────────────────────────────────────────────────
select results_eq(
  $$ select count(*)::int from public.course_tracks where id = '27000000-0000-4000-8000-060000000001' and top_cover_asset_id is null $$,
  array[1], 'no backfill: A''s track was inserted without a second cover and reads NULL in top_cover_asset_id');
select results_eq(
  $$ select count(*)::int from public.courses where id = '27000000-0000-4000-8000-070000000001' and top_cover_asset_id is null $$,
  array[1], 'no backfill: A''s course was inserted without a second cover and reads NULL in top_cover_asset_id');
select results_eq(
  $$ select count(*)::int from public.course_modules where id = '27000000-0000-4000-8000-080000000001' and cover_asset_id is null and top_cover_asset_id is null $$,
  array[1], 'no backfill: A''s module was inserted without a second cover and reads NULL in cover_asset_id, top_cover_asset_id');
select results_eq(
  $$ select count(*)::int from public.events where id = '27000000-0000-4000-8000-090000000001' and poster_asset_id is null $$,
  array[1], 'no backfill: A''s event was inserted without a second cover and reads NULL in poster_asset_id');

-- ── (3) THE POSITIVE CONTROL: the admin of A sets a second cover on each of A's five columns ──
select tests.as_tenant('27000000-0000-4000-8000-010000000001', '27000000-0000-4000-8000-020000000001', 'admin_tenant');
select results_eq(
  $$ with u as (update public.course_tracks set top_cover_asset_id = '27000000-0000-4000-8000-040000000001' where id = '27000000-0000-4000-8000-060000000001' returning top_cover_asset_id) select count(*)::int from u where top_cover_asset_id = '27000000-0000-4000-8000-040000000001' $$,
  array[1], 'positive control: the admin of A sets A''s track top cover');
select results_eq(
  $$ with u as (update public.courses set top_cover_asset_id = '27000000-0000-4000-8000-040000000001' where id = '27000000-0000-4000-8000-070000000001' returning top_cover_asset_id) select count(*)::int from u where top_cover_asset_id = '27000000-0000-4000-8000-040000000001' $$,
  array[1], 'positive control: the admin of A sets A''s course top cover');
select results_eq(
  $$ with u as (update public.course_modules set cover_asset_id = '27000000-0000-4000-8000-040000000001' where id = '27000000-0000-4000-8000-080000000001' returning cover_asset_id) select count(*)::int from u where cover_asset_id = '27000000-0000-4000-8000-040000000001' $$,
  array[1], 'positive control: the admin of A sets A''s module card cover');
select results_eq(
  $$ with u as (update public.course_modules set top_cover_asset_id = '27000000-0000-4000-8000-040000000001' where id = '27000000-0000-4000-8000-080000000001' returning top_cover_asset_id) select count(*)::int from u where top_cover_asset_id = '27000000-0000-4000-8000-040000000001' $$,
  array[1], 'positive control: the admin of A sets A''s module top cover');
select results_eq(
  $$ with u as (update public.events set poster_asset_id = '27000000-0000-4000-8000-040000000001' where id = '27000000-0000-4000-8000-090000000001' returning poster_asset_id) select count(*)::int from u where poster_asset_id = '27000000-0000-4000-8000-040000000001' $$,
  array[1], 'positive control: the admin of A sets A''s event poster');
reset role;
select tests.as_tenant('27000000-0000-4000-8000-010000000001', '27000000-0000-4000-8000-020000000003', 'member');
select results_eq(
  $$ select top_cover_asset_id::text from public.course_tracks where id = '27000000-0000-4000-8000-060000000001' $$,
  array['27000000-0000-4000-8000-040000000001'], 'positive control: a member of A reads the track top cover the admin set');
select results_eq(
  $$ select top_cover_asset_id::text from public.courses where id = '27000000-0000-4000-8000-070000000001' $$,
  array['27000000-0000-4000-8000-040000000001'], 'positive control: a member of A reads the course top cover the admin set');
select results_eq(
  $$ select cover_asset_id::text from public.course_modules where id = '27000000-0000-4000-8000-080000000001' $$,
  array['27000000-0000-4000-8000-040000000001'], 'positive control: a member of A reads the module card cover the admin set');
select results_eq(
  $$ select top_cover_asset_id::text from public.course_modules where id = '27000000-0000-4000-8000-080000000001' $$,
  array['27000000-0000-4000-8000-040000000001'], 'positive control: a member of A reads the module top cover the admin set');
select results_eq(
  $$ select poster_asset_id::text from public.events where id = '27000000-0000-4000-8000-090000000001' $$,
  array['27000000-0000-4000-8000-040000000001'], 'positive control: a member of A reads the event poster the admin set');

-- ── (4) THE NEGATIVES beside it ──────────────────────────────────────────────────────────────
-- a member of A (the lane above) updates ZERO rows of A's tracks, courses and modules
select results_eq(
  $$ with u as (update public.course_tracks set top_cover_asset_id = null where id = '27000000-0000-4000-8000-060000000001' returning top_cover_asset_id) select count(*)::int from u $$,
  array[0], 'a member of A updates zero rows: A''s track top cover is not theirs to clear');
select results_eq(
  $$ with u as (update public.courses set top_cover_asset_id = null where id = '27000000-0000-4000-8000-070000000001' returning top_cover_asset_id) select count(*)::int from u $$,
  array[0], 'a member of A updates zero rows: A''s course top cover is not theirs to clear');
select results_eq(
  $$ with u as (update public.course_modules set cover_asset_id = null where id = '27000000-0000-4000-8000-080000000001' returning cover_asset_id) select count(*)::int from u $$,
  array[0], 'a member of A updates zero rows: A''s module card cover is not theirs to clear');
select results_eq(
  $$ with u as (update public.course_modules set top_cover_asset_id = null where id = '27000000-0000-4000-8000-080000000001' returning top_cover_asset_id) select count(*)::int from u $$,
  array[0], 'a member of A updates zero rows: A''s module top cover is not theirs to clear');
reset role;
select tests.as_tenant('27000000-0000-4000-8000-010000000001', '27000000-0000-4000-8000-020000000002', 'support_tenant');
select results_eq(
  $$ with u as (update public.course_tracks set top_cover_asset_id = null where id = '27000000-0000-4000-8000-060000000001' returning top_cover_asset_id) select count(*)::int from u $$,
  array[0], 'a support member of A updates zero rows: A''s track top cover is not theirs to clear');
select results_eq(
  $$ with u as (update public.courses set top_cover_asset_id = null where id = '27000000-0000-4000-8000-070000000001' returning top_cover_asset_id) select count(*)::int from u $$,
  array[0], 'a support member of A updates zero rows: A''s course top cover is not theirs to clear');
select results_eq(
  $$ with u as (update public.course_modules set cover_asset_id = null where id = '27000000-0000-4000-8000-080000000001' returning cover_asset_id) select count(*)::int from u $$,
  array[0], 'a support member of A updates zero rows: A''s module card cover is not theirs to clear');
select results_eq(
  $$ with u as (update public.course_modules set top_cover_asset_id = null where id = '27000000-0000-4000-8000-080000000001' returning top_cover_asset_id) select count(*)::int from u $$,
  array[0], 'a support member of A updates zero rows: A''s module top cover is not theirs to clear');
reset role;
select tests.as_tenant('27000000-0000-4000-8000-010000000002', '27000000-0000-4000-8000-020000000004', 'admin_tenant');
-- the admin of B (a real admin, in another tenant) updates ZERO of A's rows and selects NONE of them
select results_eq(
  $$ with u as (update public.course_tracks set top_cover_asset_id = '27000000-0000-4000-8000-040000000002' where id = '27000000-0000-4000-8000-060000000001' returning top_cover_asset_id) select count(*)::int from u $$,
  array[0], 'cross-tenant: the admin of B updates zero rows of A''s track top cover');
select results_eq(
  $$ with u as (update public.courses set top_cover_asset_id = '27000000-0000-4000-8000-040000000002' where id = '27000000-0000-4000-8000-070000000001' returning top_cover_asset_id) select count(*)::int from u $$,
  array[0], 'cross-tenant: the admin of B updates zero rows of A''s course top cover');
select results_eq(
  $$ with u as (update public.course_modules set cover_asset_id = '27000000-0000-4000-8000-040000000002' where id = '27000000-0000-4000-8000-080000000001' returning cover_asset_id) select count(*)::int from u $$,
  array[0], 'cross-tenant: the admin of B updates zero rows of A''s module card cover');
select results_eq(
  $$ with u as (update public.course_modules set top_cover_asset_id = '27000000-0000-4000-8000-040000000002' where id = '27000000-0000-4000-8000-080000000001' returning top_cover_asset_id) select count(*)::int from u $$,
  array[0], 'cross-tenant: the admin of B updates zero rows of A''s module top cover');
select results_eq(
  $$ with u as (update public.events set poster_asset_id = '27000000-0000-4000-8000-040000000002' where id = '27000000-0000-4000-8000-090000000001' returning poster_asset_id) select count(*)::int from u $$,
  array[0], 'cross-tenant: the admin of B updates zero rows of A''s event poster');
select is_empty(
  $$ select top_cover_asset_id from public.course_tracks where id = '27000000-0000-4000-8000-060000000001' $$,
  'cross-tenant: the admin of B does not read A''s track top cover');
select is_empty(
  $$ select top_cover_asset_id from public.courses where id = '27000000-0000-4000-8000-070000000001' $$,
  'cross-tenant: the admin of B does not read A''s course top cover');
select is_empty(
  $$ select cover_asset_id from public.course_modules where id = '27000000-0000-4000-8000-080000000001' $$,
  'cross-tenant: the admin of B does not read A''s module card cover');
select is_empty(
  $$ select top_cover_asset_id from public.course_modules where id = '27000000-0000-4000-8000-080000000001' $$,
  'cross-tenant: the admin of B does not read A''s module top cover');
select is_empty(
  $$ select poster_asset_id from public.events where id = '27000000-0000-4000-8000-090000000001' $$,
  'cross-tenant: the admin of B does not read A''s event poster');
reset role;
-- A's values are intact after every refused write (read as the migration role)
select results_eq(
  $$ select top_cover_asset_id::text from public.course_tracks where id = '27000000-0000-4000-8000-060000000001' $$,
  array['27000000-0000-4000-8000-040000000001'], 'A''s track top cover still holds A''s asset after the member, support and cross-tenant attempts');
select results_eq(
  $$ select top_cover_asset_id::text from public.courses where id = '27000000-0000-4000-8000-070000000001' $$,
  array['27000000-0000-4000-8000-040000000001'], 'A''s course top cover still holds A''s asset after the member, support and cross-tenant attempts');
select results_eq(
  $$ select cover_asset_id::text from public.course_modules where id = '27000000-0000-4000-8000-080000000001' $$,
  array['27000000-0000-4000-8000-040000000001'], 'A''s module card cover still holds A''s asset after the member, support and cross-tenant attempts');
select results_eq(
  $$ select top_cover_asset_id::text from public.course_modules where id = '27000000-0000-4000-8000-080000000001' $$,
  array['27000000-0000-4000-8000-040000000001'], 'A''s module top cover still holds A''s asset after the member, support and cross-tenant attempts');
select results_eq(
  $$ select poster_asset_id::text from public.events where id = '27000000-0000-4000-8000-090000000001' $$,
  array['27000000-0000-4000-8000-040000000001'], 'A''s event poster still holds A''s asset after the member, support and cross-tenant attempts');

-- ── (5) THE CLEAR: the admin of A writes NULL back (the positive control closes the loop) ──────
select tests.as_tenant('27000000-0000-4000-8000-010000000001', '27000000-0000-4000-8000-020000000001', 'admin_tenant');
select results_eq(
  $$ with u as (update public.course_tracks set top_cover_asset_id = null where id = '27000000-0000-4000-8000-060000000001' returning top_cover_asset_id) select count(*)::int from u where top_cover_asset_id is null $$,
  array[1], 'positive control: the admin of A clears A''s track top cover');
select results_eq(
  $$ with u as (update public.courses set top_cover_asset_id = null where id = '27000000-0000-4000-8000-070000000001' returning top_cover_asset_id) select count(*)::int from u where top_cover_asset_id is null $$,
  array[1], 'positive control: the admin of A clears A''s course top cover');
select results_eq(
  $$ with u as (update public.course_modules set cover_asset_id = null where id = '27000000-0000-4000-8000-080000000001' returning cover_asset_id) select count(*)::int from u where cover_asset_id is null $$,
  array[1], 'positive control: the admin of A clears A''s module card cover');
select results_eq(
  $$ with u as (update public.course_modules set top_cover_asset_id = null where id = '27000000-0000-4000-8000-080000000001' returning top_cover_asset_id) select count(*)::int from u where top_cover_asset_id is null $$,
  array[1], 'positive control: the admin of A clears A''s module top cover');
select results_eq(
  $$ with u as (update public.events set poster_asset_id = null where id = '27000000-0000-4000-8000-090000000001' returning poster_asset_id) select count(*)::int from u where poster_asset_id is null $$,
  array[1], 'positive control: the admin of A clears A''s event poster');
reset role;

select * from finish();
rollback;
